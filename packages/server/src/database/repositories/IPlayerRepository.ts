export interface PlayerRecord {
  id: number;
  username: string;
  createdAt: string;
}

export interface IPlayerRepository {
  findById(id: number): Promise<PlayerRecord | undefined>;
  findByUsername(username: string): Promise<PlayerRecord | undefined>;
  create(username: string): Promise<PlayerRecord>;
}
