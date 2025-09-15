export * from './shared';
export * from './core';
export * from './wiki';
export * from './milestones';
export * from './pipelines';
export * from './workitems';
export * from './labels';
export * from './mrs';
export * from './files';
export * from './variables';

// Export handlers
export * from './core/handlers';
export * from './labels/handlers';
export * from './mrs/handlers';
export * from './files/handlers';
export * from './variables/handlers';
export * from './wiki/handlers';
export * from './milestones/handlers';
export * from './pipelines/handlers';
export * from './workitems/handlers';

// Legacy function factory has been removed - all entities now use the registry pattern
