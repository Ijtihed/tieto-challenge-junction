export function createServer() {
  const routes: { method: string; path: string; handler: Function }[] = [];
  return {
    get(path: string, handler: Function) { routes.push({ method: "GET", path, handler }); },
    post(path: string, handler: Function) { routes.push({ method: "POST", path, handler }); },
    routes,
  };
}
