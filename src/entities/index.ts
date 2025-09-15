export * from './shared';
export * from './core';
export * from './wiki';
export * from './milestones';
export * from './pipelines';
export * from './workitems';
export * from './labels';
export * from './mrs';
export * from './files';

// Export handlers
export * from './core/handlers';
export * from './labels/handlers';
export * from './mrs/handlers';
export * from './files/handlers';

// Export dynamic function factory handlers
export { getDynamicHandlers } from './function-factory';
