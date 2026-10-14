// Fixed codes and bounded aggregate metadata only. No SQL, rows, IDs or errors.
export interface CentralRestDiagnostic {
  code:'COMPLETE'|'LIMIT_REACHED'|'FAILED'|'TIMEOUT'|'CANCELLED';
  phase:'SIGNER'|'PREFLIGHT'|'RESULT'|'PARTITION'|'ROW_VALIDATION';
  httpStatus:number|null;
  numRows:number|null;
  receivedRows:number|null;
  partitionCount:number|null;
  completedPartitions:number;
  partitionRowCountSum:number|null;
  partitionCountsMatch:boolean|null;
  responseComplete:boolean;
}
