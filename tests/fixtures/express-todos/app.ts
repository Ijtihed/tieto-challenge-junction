import { createServer } from "./server";
import { todoRoutes } from "./routes";

const app = createServer();
todoRoutes(app);

export { app };
