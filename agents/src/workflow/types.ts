export type StepType = 'auto' | 'gate' | 'judgment';

export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'skipped'
  | 'failed';

export interface VerifyCheck {
  kind: 'files_exist' | 'tsc' | 'route_renders' | 'test' | 'manual';
  spec: string;
}

export interface GateSatisfaction {
  satisfiedBy: 'user_approval' | 'user_answer' | 'attachment';
  reference: string;
  recordedAt: string;
}

export interface StepGate {
  prompt: string;
  satisfaction?: GateSatisfaction;
}

export interface WorkflowStep {
  id: string;
  title: string;
  type: StepType;
  status: StepStatus;
  dependsOn: string[];
  ownedFiles: string[];
  verify: VerifyCheck[];
  gate?: StepGate;
  commitHash?: string;
  assignedBuilder?: string;
  notes?: string;
}

export type WorkflowArchetype = 'site' | 'app' | 'game' | 'custom';

export interface NorthStar {
  goals: string[];
  audience: string;
  voice: string;
}

export interface WorkflowState {
  schemaVersion: 1;
  appId: string;
  archetype: WorkflowArchetype;
  northStar: NorthStar;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}
