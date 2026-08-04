// @ts-check
const ts = require('typescript');
const {
  NameRegistry,
  buildEncodedTableStatements,
  generateDecoyMembers,
  DECODE_FN_IDENTIFIER,
  GLOBAL_OBJECT_IDENTIFIER,
} = require('./obfuscate-properties.cjs');

/**
 * The actual ts.TransformerFactory — see obfuscate-properties.cjs for the overall design
 * doc comment (including why each file gets its own self-contained table rather than one
 * shared across the program).
 *
 * Node kinds rewritten (each turns a static name into a computed `$T(index)` lookup):
 *   - PropertyAccessExpression      obj.foo            -> obj[$T(i)]
 *   - Optional-chain property access obj?.foo          -> obj?.[$T(i)]
 *   - PropertyDeclaration (class field)   foo = 1;     -> [$T(i)] = 1;
 *   - MethodDeclaration                   foo() {}     -> [$T(i)]() {}
 *   - GetAccessorDeclaration              get foo() {} -> get [$T(i)]() {}
 *   - SetAccessorDeclaration              set foo(v){} -> set [$T(i)](v){}
 *   - PropertyAssignment (object literal) ({ foo: 1 }) -> ({ [$T(i)]: 1 })
 *   - ShorthandPropertyAssignment         ({ foo })    -> ({ [$T(i)]: foo })
 *   - BindingElement (object destructuring)  const { foo } = x       -> const { [$T(i)]: foo } = x
 *                                             const { foo: bar } = x -> const { [$T(i)]: bar } = x
 *   - bare global Identifier (value position only)  WebSocket        -> _gbl[$T(i)]
 *                                                    window.foo      -> _gbl[$T(j)].foo
 *

 * The BindingElement case matters more than it might look: an earlier version of this
 * transformer omitted it entirely, and the mismatch it created was NOT a runtime string
 * mismatch (a destructuring read like `const { onSessionChange } = x` still resolves the
 * plain string "onSessionChange" against x, which does genuinely have that key, computed or
 * not — decoding a computed key always produces the same plaintext). The real breakage was
 * TERSER'S mangle.properties pass downstream: with the WRITE side hidden behind a computed
 * `$T(i)` call, Terser's own property-usage analysis can't see that a given destructured
 * read corresponds to the same property, so it mangles the untouched destructuring read to
 * an unrelated short name while the computed write (opaque to Terser) keeps working against
 * the real, unmangled string — reading and writing two DIFFERENT properties post-Terser,
 * producing "X is not a function" crashes. Rewriting the destructuring site the same way
 * closes that gap, since it removes the plain/manglable name Terser could see in the first
 * place.
 *
 * Deliberately left untouched (full coverage was the goal, but these remain hard blockers,
 * not oversights — see below for why each one is structurally unsafe to rewrite):
 *   - `super.foo()` / `super.foo` — TypeScript's own emit for a computed `super[expr]` MEMBER
 *     READ is legal JS, but a computed super *method call* changes `this`-binding dispatch
 *     semantics in ways that aren't a safe mechanical rewrite; skipped unconditionally.
 *     Verified before writing this transform: no `super.` usage exists anywhere in
 *     packages/shared or packages/client today, so this exclusion costs nothing in practice.
 *   - private `#field` names — `#name` is a PrivateIdentifier node, a distinct AST kind from
 *     Identifier with hard language-level restrictions on where it may appear (never as a
 *     computed member name) — structurally impossible to rewrite the same way. Verified: none
 *     exist in this codebase today.
 *   - decorator-annotated class members — a decorator can read/redefine the member via its
 *     original name (Object.defineProperty, reflection metadata); rewriting the member
 *     without understanding what the decorator does with that name risks silently breaking
 *     it, so any member with a decorator is skipped. Verified: no decorators exist in this
 *     codebase today.
 *   - constructor PARAMETER properties (`constructor(private readonly world: World)`) — this
 *     is TypeScript's shorthand for declaring-and-assigning a field from a constructor
 *     parameter in one place, used extensively throughout this codebase. TS lowers it into a
 *     field declaration plus a `this.world = world;` assignment INSIDE emit itself, after
 *     this transformer's `before` pass has already finished running — so the assignment
 *     statement doesn't exist as a node this transformer can ever see or rewrite, and a
 *     constructor parameter's own name cannot be a computed expression in TS/JS at all (only
 *     object/class members with an explicit computed-name position can be). An earlier
 *     version of this transformer didn't account for this: it correctly rewrote every USAGE
 *     site (`this.world.init()` -> `this[$T(i)][$T(j)]()`, since a property-access
 *     expression is just a normal node) while the actual declaration/assignment for
 *     parameter-property fields stayed emitted under their real literal name — silently
 *     reading/writing two different properties at runtime and crashing with "Cannot read
 *     properties of undefined". isEligibleSymbol() below checks
 *     ts.isParameterPropertyDeclaration() on every candidate symbol's declaration and treats
 *     any match as out of scope, so usage sites for these fields are left with their real
 *     names too, consistently matching what emit() actually produces for the declaration.
 *   - any symbol declared in a `.tsx` FILE (SolidJS components — see packages/ui) — .tsx is
 *     compiled by babel-loader, never by ts-loader/this transformer's Program.emit() (see
 *     the module-level doc comment in obfuscate-build.cjs), so a .tsx file's own property
 *     reads (e.g. `props.onPlay` inside WelcomeOverlay.tsx, reading a field of its own
 *     WelcomeOverlayProps interface, itself declared in that same .tsx file) can never be
 *     rewritten — there is no node for this transformer to ever visit there. Interfaces like
 *     WelcomeOverlayProps/ChatBoxProps are declared INSIDE their .tsx file specifically
 *     (not a sibling .ts), so a plain directory-prefix scope check alone doesn't catch this:
 *     the file is genuinely under packages/ui/src (in scope by directory), just not
 *     reachable by this transformer at all. Concretely, this surfaced as: a client/src/*.ts
 *     object literal passing `{ onPlay: (nickname) => {...} }` into mountWelcomeOverlay() got
 *     its `onPlay` key rewritten to a computed lookup (correct, in scope), while
 *     WelcomeOverlay.tsx's own `props.onPlay(...)` read stayed a plain, Terser-manglable
 *     property access — same "write hidden behind $T(i), plain read gets independently
 *     mangled by Terser" mismatch as the BindingElement case above, just crossing a
 *     .ts/.tsx boundary instead of a destructuring one. isTsxFile() below is checked
 *     alongside isInScope() in both eligibility functions for exactly this reason.
 *
 * Only names the TS type-checker resolves to a declaration inside the caller-provided
 * `isInScope(fileName)` boundary are ever candidates — see obfuscate-properties.cjs's
 * createScopeChecker(). Every other property name (node_modules, SolidJS internals, etc.)
 * passes through completely unmodified, the same as Terser's own domprops.cjs reserved list
 * protects against renaming those under mangle.properties.
 *
 * DOM/Web API property NAMES are the one deliberate exception, and only at
 * PropertyAccessExpression sites: `isDomProp` (see createDomPropChecker() in
 * obfuscate-properties.cjs, backed by the same domprops.cjs list) lets a read/write like
 * `ctx.fillRect` or `ws.send` become a computed `$T(i)` lookup even though `fillRect`/`send`
 * resolve to a lib.dom.d.ts declaration outside every package root and so can never pass
 * isEligibleSymbol()'s in-scope check. This does NOT rename the property — the decoded
 * string is still the literal DOM name the browser requires, so it's a no-op for
 * runtime/devtools/network-panel inspection — it only removes the static identifier from
 * the bundle's own source text, matching this transform's actual ceiling as already stated
 * above for our own property names. Declaration sites (class field/method, object-literal
 * key, destructuring binding) never consult isDomProp — see createDomPropChecker()'s own
 * doc comment for why a name collision there must not be treated as a DOM access.
 *
 * @param {() => import('typescript').Program | undefined} getProgram live accessor, NOT a
 *   captured Program snapshot — see below for why this must be called fresh on every lookup.
 * @param {(fileName: string) => boolean} isInScope
 * @param {(name: string) => boolean} [isDomProp] optional — see createDomPropChecker() in
 *   obfuscate-properties.cjs. When a PropertyAccessExpression's name isn't resolvable to an
 *   in-scope declaration (the normal isEligibleSymbol() path) but matches a known DOM/Web API
 *   property name, it's still rewritten to a computed $T(i) lookup — same real runtime
 *   property name (DOM properties can never be renamed), just no static string identifier
 *   left sitting in the shipped bundle source. Deliberately NOT consulted at any declaration
 *   site (class field/method, object-literal key, destructuring binding) — see
 *   createDomPropChecker()'s own doc comment for why. Defaults to a checker that matches
 *   nothing, so omitting this parameter reproduces the exact previous behavior.
 * @param {(name: string) => boolean} [isGlobalName] optional — same name list as isDomProp
 *   (domprops.cjs already lists "WebSocket", "window", "document",
 *   "requestAnimationFrame", etc. alongside property names), consulted for a completely
 *   different AST shape: a BARE Identifier expression (`WebSocket`, not `obj.WebSocket`).
 *   See isEligibleGlobalIdentifier() below for the full eligibility check (must resolve via
 *   the checker to a value symbol declared OUTSIDE isInScope — i.e. actually the real
 *   global, never a same-named local/parameter/import shadowing it). The replacement
 *   `_gbl[$T(i)]` expression's `_gbl` is a free identifier this transformer never declares —
 *   it's provided once for the whole bundle via webpack.ProvidePlugin (see
 *   obfuscate-global-runtime.js and its registration in webpack.prod.js), not synthesized
 *   per file. Defaults to a checker that matches nothing, so omitting this parameter
 *   reproduces the exact previous behavior (no bare identifiers are ever rewritten).
 * @param {number} [decoyFieldCount] optional, default 0 (no decoys, exact previous
 *   behavior). When > 0, this is the MAX of a per-class random range — each in-scope class
 *   independently rolls its own decoy field count via randomCountInRange() below (roughly
 *   60%-100% of this max, so passing 100 yields ~60-100 decoy fields per class, not a flat
 *   100 on every class), then gets that many extra fake `PropertyDeclaration` members
 *   spliced in at random positions among its real members — see generateDecoyMembers() in
 *   obfuscate-properties.cjs for the name/value pools and the ClassDeclaration visit case
 *   below for the collision-safety and position-randomization details. Purely cosmetic
 *   noise on a dumped instance's shape — nothing in this codebase ever reads a decoy field,
 *   so there is no live behavior riding on this and no way it can change what the program
 *   actually does.
 * @param {number} [decoyMethodCount] optional, default 0 (no decoy methods). Same "max of a
 *   per-class random range" semantics as decoyFieldCount (requires decoyFieldCount > 0 too —
 *   a decoy method's body always reads decoy fields from the same batch, see
 *   generateDecoyMembers()'s own doc comment). Each extra fake `MethodDeclaration` body is
 *   one of a few shapes (a plain return, an if/else, or a switch — see bodyShapes in
 *   generateDecoyMembers()) that ONLY ever reads this same decoy batch's own fields — never
 *   a loop, never a call to anything real, never a write, never a reference to a real class
 *   member. Same "purely cosmetic, never invoked, cannot change program behavior" guarantee
 *   as decoyFieldCount — control flow is included here specifically because that
 *   self-containment makes it safe; real (physics/render/network) method bodies are never
 *   touched this way.
 * @returns {import('typescript').TransformerFactory<import('typescript').SourceFile>}
 */
function createObfuscationTransformer(
  getProgram,
  isInScope,
  isDomProp = () => false,
  isGlobalName = () => false,
  decoyFieldCount = 0,
  decoyMethodCount = 0,
) {
  /**
   * Rolls a random integer count in [ceil(max * 0.6), max] — the "~60-100 typical" range
   * this module's own decoyFieldCount/decoyMethodCount doc comments describe, parameterized
   * by the caller-supplied max rather than hardcoded, so passing a smaller max (e.g. 10)
   * still produces a proportional random range (6-10) instead of always maxing out.
   */
  function randomCountInRange(/** @type {number} */min_, /** @type {number} */ max) {
    const min = Math.max(min_, Math.ceil(max * 0.6));
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  /** True if `name` should never be touched regardless of scope (JS/TS structural reasons). */
  function isStructurallyExempt(/** @type {string} */ name) {
    // Computed-key syntax is legal for these too, but there is no obfuscation value in
    // hiding fixed language contracts an attacker already knows to look for, and rewriting
    // "constructor" specifically interacts badly with class emit.
    return name === 'constructor' || name === '__proto__';
  }

  /** True if `fileName` is a .tsx file — see the module doc comment for why these are always excluded. */
  function isTsxFile(/** @type {string} */ fileName) {
    return fileName.endsWith('.tsx');
  }

  /** Combines the scope-boundary check with the .tsx exclusion — used by both eligibility functions below. */
  function isRewritableDeclarationSite(/** @type {import('typescript').Declaration} */ decl) {
    const fileName = decl.getSourceFile().fileName;
    return isInScope(fileName) && !isTsxFile(fileName);
  }

  /**
   * Resolves a symbol for `node` and returns whether its declaration falls inside scope.
   *
   * Calls getProgram() fresh on every single lookup rather than capturing one Program/
   * TypeChecker once — ts-loader's transpileOnly mode (see instances.js's
   * initializeInstance()) constructs its `before`-transformer Program with an EMPTY root
   * file list (`compiler.createProgram([], compilerOptions)`) and only incrementally feeds
   * it real source as each file is transpiled; a Program/TypeChecker captured at
   * getCustomTransformers() call time therefore has NOTHING in it yet, and
   * getSymbolAtLocation() silently returns undefined for everything, which is why an
   * earlier version of this transformer rewrote class member DECLARATIONS (visited as part
   * of the same file currently being added to the program) but silently skipped every
   * property-access USAGE elsewhere — those symbols simply weren't resolvable against the
   * stale empty program snapshot. getProgram() is ts-loader's live accessor for exactly this
   * reason (see instances.js: `const getProgram = () => program;`), so every lookup here
   * re-fetches the current Program/TypeChecker instead of trusting a first-call snapshot.
   */
  function isEligibleSymbol(/** @type {import('typescript').Node} */ node) {
    const program = getProgram();
    if (!program) {
      return false;
    }
    const symbol = program.getTypeChecker().getSymbolAtLocation(node);
    if (!symbol) {
      return false;
    }
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return false;
    }
    // Constructor parameter properties can never be rewritten — see the module doc comment
    // for the full explanation of why. Checked before the scope check below since this is a
    // structural JS/TS restriction, not a scope-boundary judgment call.
    if (declarations.some((decl) => ts.isParameterPropertyDeclaration(decl, decl.parent))) {
      return false;
    }
    // Every declaration site must be in scope AND not a .tsx file, not just one — a name
    // re-exported/re-declared (e.g. an interface merged across an in-scope and
    // out-of-scope file) is ambiguous enough to skip rather than risk rewriting a
    // DOM-adjacent access by accident. See isRewritableDeclarationSite()/isTsxFile()'s own
    // doc comments for why .tsx is excluded even when its directory is in scope.
    return declarations.every(isRewritableDeclarationSite);
  }

  /** @type {(node) => boolean} */
  function hasDecorators(node) {
    return ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0;
  }

  /**
   * Every member name reachable on instances of `classNode` — OWN declared members AND
   * everything inherited from a base class/interface, via the checker's resolved type
   * (`getPropertiesOfType()` walks the full inheritance chain, unlike reading
   * `classNode.members` directly which only sees this one declaration's own members). Used
   * exclusively to build the exclusion set generateDecoyFields() checks against: a decoy
   * field must never reuse ANY name reachable on the class, own or inherited, or it would
   * silently shadow a real field's value on every instance. Returns an empty Set (no decoys
   * possible, but never throws) if the checker can't resolve a type here — e.g. the Program
   * being mid-construction under ts-loader's transpileOnly mode, same caveat already
   * documented on isEligibleSymbol() above.
   */
  function collectAllMemberNames(
    /** @type {import('typescript').ClassDeclaration | import('typescript').ClassExpression} */ classNode,
  ) {
    /** @type {Set<string>} */
    const names = new Set();
    const program = getProgram();
    if (!program) {
      return names;
    }
    const checker = program.getTypeChecker();
    const type = checker.getTypeAtLocation(classNode);
    for (const symbol of checker.getPropertiesOfType(type)) {
      names.add(symbol.getName());
    }
    return names;
  }

  /**
   * Resolves eligibility for an object-literal property key (PropertyAssignment or
   * ShorthandPropertyAssignment) — NOT via checker.getSymbolAtLocation(nameNode), which
   * resolves to the PropertyAssignment/ShorthandPropertyAssignment node ITSELF (the object
   * literal's own local member declaration), not to whatever interface/type member the
   * object literal is being contextually typed against. This matters whenever the object
   * literal is passed somewhere with an explicit type — e.g. `mountWelcomeOverlay(root, {
   * onPlay: ... })`, where the second argument's declared parameter type is
   * WelcomeOverlayProps: getSymbolAtLocation would (wrongly) treat `onPlay` as a plain local
   * property owned by client/src/index.ts itself and rewrite it, while
   * WelcomeOverlayProps.onPlay is read via plain `props.onPlay` inside WelcomeOverlay.tsx (a
   * file this transformer can never touch — see the module doc comment's .tsx exclusion) —
   * producing the exact "write hidden behind $T(i), unrelated plain read gets independently
   * mangled by Terser" crash this whole eligibility layer exists to prevent.
   * checker.getContextualType() gives the type the object literal is actually being checked
   * against (WelcomeOverlayProps here), and .getProperty(name) on THAT type resolves to the
   * real declaration (WelcomeOverlayProps.onPlay in WelcomeOverlay.tsx), which then correctly
   * fails isRewritableDeclarationSite()'s .tsx check. Falls back to the plain
   * getSymbolAtLocation() result when there's no contextual type (a genuinely free-standing
   * object literal with no expected shape) or the contextual type doesn't have this
   * property (a looser/wider contextual type than the literal's own shape) — in both cases
   * the object literal's own declaration is the only meaningful "owner" of the property.
   */
  function isEligibleObjectLiteralProperty(
    /** @type {import('typescript').ObjectLiteralExpression} */ objectLiteral,
    /** @type {import('typescript').Identifier} */ nameNode,
  ) {
    const program = getProgram();
    if (!program) {
      return false;
    }
    const checker = program.getTypeChecker();
    const contextualType = checker.getContextualType(objectLiteral);
    const contextualSymbol = contextualType?.getProperty(nameNode.text);
    const symbol = contextualSymbol ?? checker.getSymbolAtLocation(nameNode);
    if (!symbol) {
      return false;
    }
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return false;
    }
    if (declarations.some((decl) => ts.isParameterPropertyDeclaration(decl, decl.parent))) {
      return false;
    }
    return declarations.every(isRewritableDeclarationSite);
  }

  /**
   * Resolves the SOURCE property symbol a BindingElement destructures — NOT
   * checker.getSymbolAtLocation(node.name), which for a shorthand `{ foo }` (no explicit
   * node.propertyName) resolves to the newly-introduced local binding itself (declaration
   * kind BindingElement) rather than the object's own property declaration. Going through
   * the destructured expression's TYPE and calling type.getProperty(name) instead resolves
   * correctly for both `{ foo }` and `{ foo: renamed }` uniformly, since it looks up the
   * SOURCE object's property by name rather than asking what the new binding refers to.
   */
  function isEligibleBindingElement(/** @type {import('typescript').BindingElement} */ node) {
    const pattern = node.parent;
    if (!ts.isObjectBindingPattern(pattern)) {
      return false;
    }
    const owner = pattern.parent;
    const initializer = ts.isVariableDeclaration(owner) || ts.isParameter(owner) ? owner.initializer : undefined;
    if (!initializer) {
      return false;
    }
    const program = getProgram();
    if (!program) {
      return false;
    }
    const checker = program.getTypeChecker();
    const type = checker.getTypeAtLocation(initializer);
    const propertyNameNode = node.propertyName ?? node.name;
    if (!ts.isIdentifier(propertyNameNode)) {
      return false;
    }
    const symbol = type.getProperty(propertyNameNode.text);
    if (!symbol) {
      return false;
    }
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return false;
    }
    if (declarations.some((decl) => ts.isParameterPropertyDeclaration(decl, decl.parent))) {
      return false;
    }
    return declarations.every(isRewritableDeclarationSite);
  }

  /**
   * True if `node` (a bare Identifier expression, e.g. the `WebSocket` in `new
   * WebSocket(url)` or the `window` in `window.innerWidth`) resolves to the REAL global —
   * declared OUTSIDE every scope root (lib.dom.d.ts, @types/node's ambient globals, etc.),
   * never a local variable/parameter/import/class-member that merely shares the name.
   *
   * This is the OPPOSITE direction from isEligibleSymbol()/isRewritableDeclarationSite()
   * above (which require the declaration to be INSIDE scope) — deliberately: a bare global's
   * declaration can never be inside our own package roots by definition, it's not something
   * this codebase declares. isDomProp()/isGlobalName() (the caller-supplied name-membership
   * check, applied by the visit() switch below before this function is even called) is what
   * keeps this from matching arbitrary out-of-scope symbols — this function only confirms
   * that a NAME already known to be a real global name isn't shadowed at this specific
   * location.
   *
   * ts.isPartOfTypeNode() excludes type-only positions (`type WS = WebSocket`, `x:
   * WebSocket`) — the identifier there is a type reference, not a value read, and rewriting
   * it to a runtime expression (`_gbl[$T(i)]`) would be invalid TypeScript at those
   * positions (a computed lookup isn't a type). `typeof WebSocket` (a genuine runtime
   * typeof-operator expression, not a type annotation) is NOT excluded by this check and IS
   * eligible — verified directly that ts.isPartOfTypeNode() returns false for the operand of
   * a TypeOfExpression, only true for an actual TypeReferenceNode's identifier.
   */
  function isEligibleGlobalIdentifier(/** @type {import('typescript').Identifier} */ node) {
    if (ts.isPartOfTypeNode(node)) {
      return false;
    }
    const program = getProgram();
    if (!program) {
      return false;
    }
    const symbol = program.getTypeChecker().getSymbolAtLocation(node);
    if (!symbol) {
      return false;
    }
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return false;
    }
    // A shadowing local declares itself INSIDE scope (or, for a shadowing .tsx/.d.ts-free
    // ambient case elsewhere in node_modules, simply isn't a value declared in a lib file at
    // all) — either way, every declaration failing "is outside scope" means this occurrence
    // is not the real global and must be left alone.
    return declarations.every((decl) => !isInScope(decl.getSourceFile().fileName));
  }

  /** @type {import('typescript').TransformerFactory<import('typescript').SourceFile>} */
  return (context) => {
    const { factory } = context;

    return (sourceFile) => {
      // Fresh per file — see the module doc comment for why table scope is per file, not
      // shared across the whole program.
      const registry = new NameRegistry();

      function computedKeyFor(/** @type {string} */ name) {
        const index = registry.indexFor(name);
        return factory.createCallExpression(factory.createIdentifier(DECODE_FN_IDENTIFIER), undefined, [
          factory.createNumericLiteral(index),
        ]);
      }

      /** @type {(node: import('typescript').Node) => import('typescript').Node} */
      function visit(node) {
        // --- obj.foo / obj?.foo (but never super.foo — see module doc comment) ----------
        if (ts.isPropertyAccessExpression(node) && !ts.isPrivateIdentifier(node.name)) {
          const visitedExpression = ts.visitNode(node.expression, visit, ts.isExpression);
          if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
            return factory.updatePropertyAccessExpression(node, visitedExpression, node.name);
          }
          const name = node.name.text;
          if (!isStructurallyExempt(name) && (isEligibleSymbol(node.name) || isDomProp(name))) {
            const key = computedKeyFor(name);
            return node.questionDotToken
              ? factory.createElementAccessChain(visitedExpression, node.questionDotToken, key)
              : factory.createElementAccessExpression(visitedExpression, key);
          }
          return factory.updatePropertyAccessExpression(node, visitedExpression, node.name);
        }

        // --- class declaration: splice decoy fields/methods among real members ----------
        // Must intercept the ClassDeclaration itself (not just individual members) since
        // this is the only point that can insert new members into node.members — the
        // member-declaration case below only rewrites members that already exist. Runs
        // BEFORE that case in source order so decoys aren't accidentally re-visited as if
        // they were real members (they're spliced into the already-visited member list, not
        // fed back through visit()).
        //
        // Both the COUNT (random per class, ~60-100 independently for fields and methods —
        // see randomCountInRange() below) and the POSITION (each decoy is inserted at a
        // uniformly random index among the real members, not appended at the end) are
        // randomized. Position randomization is safe specifically because class field
        // initializers run top-to-bottom in DECLARATION order regardless of where the
        // constructor sits textually (verified directly: a field declared after the
        // constructor still initializes correctly, right after the constructor runs, per
        // the class-fields spec) — decoys never read or write anything but their own decoy
        // state, so interleaving them anywhere cannot change when or how a REAL field
        // initializes. The one invariant this code preserves deliberately: real members'
        // RELATIVE order among themselves is never changed (only decoys are inserted between
        // them) — permuting real members could break a real field whose initializer depends
        // on an earlier real field (e.g. `b = this.a + 1`), which decoy insertion must never
        // risk. Decoy METHODS are generated after decoy FIELDS (via generateDecoyMembers)
        // so every decoy method's body can reference a decoy field that already exists,
        // regardless of where either ends up after interleaving.
        if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && decoyFieldCount > 0) {
          const visitedMembers = [...ts.visitNodes(node.members, visit, ts.isClassElement) ?? node.members];
          const excludeNames = collectAllMemberNames(node);
          const fieldCount = randomCountInRange(5, decoyFieldCount);
          const methodCount = decoyMethodCount > 0 ? randomCountInRange(10, decoyMethodCount) : 0;
          const { fields, methods } = generateDecoyMembers(
            Math.random,
            fieldCount,
            methodCount,
            excludeNames,
            computedKeyFor,
          );
          const decoyFieldMembers = fields.map(({ name, value }) =>
            factory.createPropertyDeclaration(
              undefined,
              factory.createComputedPropertyName(computedKeyFor(name)),
              undefined,
              undefined,
              value,
            ),
          );
          const decoyMethodMembers = methods.map(({ name, body }) =>
            factory.createMethodDeclaration(
              undefined,
              undefined,
              factory.createComputedPropertyName(computedKeyFor(name)),
              undefined,
              undefined,
              [],
              undefined,
              factory.createBlock(body, true),
            ),
          );
          // Insert each decoy at a uniformly random index into the growing member list — an
          // insertion (not a swap) at each step, so real members are only ever pushed later
          // in the array, never reordered relative to each other.
          const mergedMembers = [...visitedMembers];
          for (const decoyMember of [...decoyFieldMembers, ...decoyMethodMembers]) {
            const insertAt = Math.floor(Math.random() * (mergedMembers.length + 1));
            mergedMembers.splice(insertAt, 0, decoyMember);
          }
          const updatedMembers = factory.createNodeArray(mergedMembers);
          return ts.isClassDeclaration(node)
            ? factory.updateClassDeclaration(
                node,
                node.modifiers,
                node.name,
                node.typeParameters,
                node.heritageClauses,
                updatedMembers,
              )
            : factory.updateClassExpression(
                node,
                node.modifiers,
                node.name,
                node.typeParameters,
                node.heritageClauses,
                updatedMembers,
              );
        }

        // --- class field / method / accessor declarations --------------------------------
        if (
          (ts.isPropertyDeclaration(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node)) &&
          ts.isIdentifier(node.name)
        ) {
          const name = node.name.text;
          if (!hasDecorators(node) && !isStructurallyExempt(name) && isEligibleSymbol(node.name)) {
            const computedName = factory.createComputedPropertyName(computedKeyFor(name));
            return ts.visitEachChild(cloneWithName(factory, node, computedName), visit, context);
          }
          return ts.visitEachChild(node, visit, context);
        }

        // --- object literal: { foo: 1 } and shorthand { foo } ----------------------------
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ts.isObjectLiteralExpression(node.parent)) {
          const name = node.name.text;
          const visitedInitializer = ts.visitNode(node.initializer, visit, ts.isExpression);
          if (!isStructurallyExempt(name) && isEligibleObjectLiteralProperty(node.parent, node.name)) {
            const computedName = factory.createComputedPropertyName(computedKeyFor(name));
            return factory.createPropertyAssignment(computedName, visitedInitializer);
          }
          return factory.updatePropertyAssignment(node, node.name, visitedInitializer);
        }
        if (ts.isShorthandPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
          const name = node.name.text;
          if (!isStructurallyExempt(name) && isEligibleObjectLiteralProperty(node.parent, node.name)) {
            const computedName = factory.createComputedPropertyName(computedKeyFor(name));
            // Shorthand { foo } has no separate initializer node — the identifier IS both
            // the key and the value read, so the value expression is a fresh reference to
            // the same-named local variable/binding.
            return factory.createPropertyAssignment(computedName, factory.createIdentifier(name));
          }
          return node;
        }

        // --- object destructuring: const { foo } / const { foo: bar } = obj -------------
        // See the module doc comment for why this matters even though a plain-string
        // destructuring read would still technically resolve correctly at runtime — this
        // exists to keep Terser's OWN mangle.properties pass from renaming an unrewritten
        // read out of sync with a rewritten (computed, opaque-to-Terser) write elsewhere.
        if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
          const propertyNameNode = node.propertyName ?? node.name;
          if (ts.isIdentifier(propertyNameNode)) {
            const name = propertyNameNode.text;
            if (!isStructurallyExempt(name) && isEligibleBindingElement(node)) {
              const computedName = factory.createComputedPropertyName(computedKeyFor(name));
              return factory.updateBindingElement(
                node,
                node.dotDotDotToken,
                computedName,
                node.name,
                node.initializer,
              );
            }
          }
          return ts.visitEachChild(node, visit, context);
        }

        // --- bare global identifier: WebSocket / window / document / etc. ---------------
        // Deliberately the LAST specific case checked, after every other node kind that
        // itself contains or IS an Identifier (PropertyAccessExpression's own .name,
        // declaration names) has already been handled and returned above — this only ever
        // sees an Identifier reached as a genuine value-reading EXPRESSION position (a
        // callee, an operand, an argument, etc.), never a name/declaration slot, since
        // those never fall through to here. See isEligibleGlobalIdentifier()'s own doc
        // comment for the shadowing/type-position exclusions.
        if (ts.isIdentifier(node)) {
          const name = node.text;
          if (!isStructurallyExempt(name) && isGlobalName(name) && isEligibleGlobalIdentifier(node)) {
            // `_gbl` is a free identifier here, never declared by this transformer — see
            // this function's own isGlobalName doc comment for why (provided once for the
            // whole bundle via webpack.ProvidePlugin, not synthesized per file).
            return factory.createElementAccessExpression(
              factory.createIdentifier(GLOBAL_OBJECT_IDENTIFIER),
              computedKeyFor(name),
            );
          }
          return node;
        }

        return ts.visitEachChild(node, visit, context);
      }

      const visited = ts.visitNode(sourceFile, visit, ts.isSourceFile) ?? sourceFile;

      const rewrittenNames = registry.names();
      if (rewrittenNames.length === 0) {
        return visited;
      }

      // Built as real synthetic AST nodes (see buildEncodedTableStatements()'s own doc
      // comment for why — an earlier version re-parsed generated source text via a second
      // ts.createSourceFile() call and spliced those nodes in, which corrupted the printed
      // output because parsed nodes carry real text-range positions into their OWN source
      // string that collide with this file's positions).
      const tableStatements = buildEncodedTableStatements(factory, rewrittenNames);
      // No `_gbl` statement injected here — unlike the string table, `_gbl` is never
      // per-file. It's a free identifier provided once for the whole bundle via
      // webpack.ProvidePlugin (see obfuscate-global-runtime.js and its registration in
      // webpack.prod.js), so any file whose visit() rewrote a bare global to `_gbl[$T(i)]`
      // above just references that free identifier directly — ProvidePlugin detects the
      // reference and auto-injects the import, the same mechanism as a `$`/`Buffer` shim.
      return factory.updateSourceFile(visited, [...tableStatements, ...visited.statements]);
    };
  };
}

/**
 * Re-creates a class member declaration with a computed name — ts.factory has no single
 * "updateName" helper that works across PropertyDeclaration/MethodDeclaration/accessors, so
 * this dispatches per node kind, preserving every other field unchanged.
 * @param {import('typescript').NodeFactory} factory
 * @param {import('typescript').PropertyDeclaration | import('typescript').MethodDeclaration | import('typescript').GetAccessorDeclaration | import('typescript').SetAccessorDeclaration} node
 * @param {import('typescript').ComputedPropertyName} computedName
 */
function cloneWithName(factory, node, computedName) {
  if (ts.isPropertyDeclaration(node)) {
    return factory.updatePropertyDeclaration(
      node,
      node.modifiers,
      computedName,
      node.questionToken ?? node.exclamationToken,
      node.type,
      node.initializer,
    );
  }
  if (ts.isMethodDeclaration(node)) {
    return factory.updateMethodDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      computedName,
      node.questionToken,
      node.typeParameters,
      node.parameters,
      node.type,
      node.body,
    );
  }
  if (ts.isGetAccessorDeclaration(node)) {
    return factory.updateGetAccessorDeclaration(
      node,
      node.modifiers,
      computedName,
      node.parameters,
      node.type,
      node.body,
    );
  }
  return factory.updateSetAccessorDeclaration(node, node.modifiers, computedName, node.parameters, node.body);
}

module.exports = { createObfuscationTransformer };
