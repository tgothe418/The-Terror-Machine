import { Router, type Request, type Response, type NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createTtmMcpServer } from './ttmMcpServer';
import { scenarioSandboxManager } from './scenarioSandbox';

export function createMcpRouter(): Router {
  const router = Router();
  const server = createTtmMcpServer(scenarioSandboxManager);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  let connected = false;
  const connectPromise = server.connect(transport).then(() => {
    connected = true;
  });

  const handleMcp = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!connected) {
        await connectPromise;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  };

  router.all('*', handleMcp);

  return router;
}

export const mcpRouter = createMcpRouter();

export async function mcpHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  mcpRouter(req, res, next);
}
