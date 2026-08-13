export type PlanChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: string;
  scope: string;
  before?: string;
  after?: string;
};

export type ChangePlan = {
  changes: PlanChange[];
  conflicts: string[];
  warnings: string[];
};

export type Installation = {
  resource: string;
  version: string;
  harness: string;
  scope: string;
};
