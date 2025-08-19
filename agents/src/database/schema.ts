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

export interface RunningProcess {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: Date;
  status: 'running' | 'stopped' | 'crashed';
}
