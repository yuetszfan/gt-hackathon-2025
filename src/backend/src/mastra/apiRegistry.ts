import { registerApiRoute } from '@mastra/core/server';
import { ChatInputSchema, ChatOutput, chatWorkflow } from './workflows/chatWorkflow';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createSSEStream } from '../utils/streamUtils';
import { storage } from './memory';
import { z } from 'zod';

// Helper function to convert Zod schema to OpenAPI schema
function toOpenApiSchema(schema: Parameters<typeof zodToJsonSchema>[0]) {
  return zodToJsonSchema(schema) as Record<string, unknown>;
}

/**
 * API routes for the Mastra backend
 *
 * These routes handle chat interactions between the Cedar-OS frontend
 * and your Mastra agents. The chat UI will automatically use these endpoints.
 *
 * - /chat: Standard request-response chat endpoint
 * - /chat/stream: Server-sent events (SSE) endpoint for streaming responses
 * - /devices: Device storage endpoint
 * - /embeddings: Embedding storage endpoint
 */
export const apiRoutes = [
  registerApiRoute('/chat/stream', {
    method: 'POST',
    openapi: {
      requestBody: {
        content: {
          'application/json': {
            schema: toOpenApiSchema(ChatInputSchema),
          },
        },
      },
    },
    handler: async (c) => {
      try {
        const body = await c.req.json();
        const {
          prompt,
          temperature,
          maxTokens,
          systemPrompt,
          additionalContext,
          resourceId,
          threadId,
        } = ChatInputSchema.parse(body);

        return createSSEStream(async (controller) => {
          const run = await chatWorkflow.createRunAsync();
          const result = await run.start({
            inputData: {
              prompt,
              temperature,
              maxTokens,
              systemPrompt,
              streamController: controller,
              additionalContext,
              resourceId,
              threadId,
            },
          });

          if (result.status !== 'success') {
            // TODO: Handle workflow errors appropriately
            throw new Error(`Workflow failed: ${result.status}`);
          }
        });
      } catch (error) {
        console.error(error);
        return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
      }
    },
  }),
  
  registerApiRoute('/devices', {
    method: 'POST',
    handler: async (c) => {
      try {
        const device = await c.req.json();
        
        // Store device in the database
        // For now, we'll use the storage adapter's underlying connection
        // In production, you would create proper tables and use SQL queries
        console.log('Storing device:', device.id, device.name);
        
        // TODO: Implement actual database storage
        // For now, just log that we received the device
        
        return c.json({ success: true, deviceId: device.id });
      } catch (error) {
        console.error('Error storing device:', error);
        return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
      }
    },
  }),
  
  registerApiRoute('/embeddings', {
    method: 'POST',
    handler: async (c) => {
      try {
        const embeddingData = await c.req.json();
        
        // Store embedding in the database
        console.log('Storing embedding:', embeddingData.id, 'for device:', embeddingData.deviceId);
        
        // TODO: Implement actual vector database storage
        // For now, just log that we received the embedding
        
        return c.json({ success: true, embeddingId: embeddingData.id });
      } catch (error) {
        console.error('Error storing embedding:', error);
        return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
      }
    },
  }),
];
