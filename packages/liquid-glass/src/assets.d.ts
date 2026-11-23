declare module "*.glsl?raw" {
  const source: string;
  export default source;
}

declare module "*?worker&inline" {
  const WorkerConstructor: new (options?: { name?: string }) => Worker;
  export default WorkerConstructor;
}
