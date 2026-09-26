import { Router, type Request, type Response, type NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createTtmMcpServer } from './ttmMcpServer';
import { scenarioSandboxManager } from './scenarioSandbox';

export function createMcpRouter(): Router {
  const router = Router();

  const handleMcp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const server = createTtmMcpServer(scenarioSandboxManager);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
      });

      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        const id =
          req.body && typeof req.body === 'object' && 'id' in req.body ? req.body.id : null;
        res.status(500).json({
          jsonrpc: '2.0',
          id: id ?? null,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } else {
        next(err);
      }
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
