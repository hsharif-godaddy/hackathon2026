export interface App {
  id: string;
  name: string;
  path: string;
  port: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppRequest {
  name: string;
}

export interface UpdateAppRequest {
  name?: string;
}
