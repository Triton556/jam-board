import type {
  ExecutionRequest,
  ExecutionRequestStatus,
  ExecutionScope,
  ExecutionState,
  ResolveExecutionRequest,
  SetExecution,
} from "../bindings";

export type {
  ExecutionRequest,
  ExecutionScope,
  ExecutionState,
  ResolveExecutionRequest,
  SetExecution,
} from "../bindings";

export interface ExecutionApi {
  getExecution(scope: ExecutionScope): Promise<ExecutionState>;
  listExecution(): Promise<ExecutionState[]>;
  setExecution(input: SetExecution): Promise<ExecutionState>;
  listExecutionRequests(
    status?: ExecutionRequestStatus,
  ): Promise<ExecutionRequest[]>;
  resolveExecutionRequest(
    input: ResolveExecutionRequest,
  ): Promise<ExecutionRequest>;
}
