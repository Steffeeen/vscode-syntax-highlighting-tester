import { spawn, Subprocess } from "bun";
import { 
    InitializeParams, 
    InitializeResult, 
    DidOpenTextDocumentParams, 
    SemanticTokensParams,
    SemanticTokens,
    SemanticTokensLegend,
    MarkupKind
} from 'vscode-languageserver-protocol';

export class LspClient {
    private proc: Subprocess | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private messageQueue: any[] = [];
    private pendingRequests = new Map<number | string, { resolve: (res: any) => void, reject: (err: any) => void }>();
    private nextId = 1;
    private isClosed = false;
    public legend: SemanticTokensLegend | null = null;
    public capabilities: any = {};

    constructor(private command: string[]) {}

    async start(rootUri: string) {
        this.proc = spawn(this.command, {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "inherit", 
        });

        this.readLoop();

        // Initialize handshake
        const initParams: InitializeParams = {
            processId: process.pid,
            rootUri: rootUri,
            capabilities: {
                textDocument: {
                    semanticTokens: {
                        dynamicRegistration: false,
                        tokenTypes: [], // Will be filled by server if we don't spec it, but client needs to say it supports it
                        tokenModifiers: [],
                        formats: ['relative'],
                        requests: {
                            range: false,
                            full: {
                                delta: false
                            }
                        }
                    },
                    synchronization: {
                        dynamicRegistration: false,
                        willSave: false,
                        willSaveWaitUntil: false,
                        didSave: false
                    }
                },
                workspace: {
                    workspaceFolders: true
                }
            }
        };

        // Allow overriding capabilities
        if (this.capabilities.textDocument) {
             Object.assign(initParams.capabilities.textDocument!, this.capabilities.textDocument);
        }

        const result = await this.sendRequest<InitializeResult>('initialize', initParams);
        
        // Capture legend
        if (result.capabilities.semanticTokensProvider && 'legend' in result.capabilities.semanticTokensProvider) {
            this.legend = result.capabilities.semanticTokensProvider.legend;
        }

        // Notify initialized
        this.sendNotification('initialized', {});
        
        return result;
    }

    private async readLoop() {
        if (!this.proc || !this.proc.stdout) return;
        
        // Check if it's a stream (it should be because of "pipe")
        if (typeof this.proc.stdout === 'number') {
            console.error("STDOUT is a file descriptor, expected stream");
            return;
        }

        // Create a reader from the web stream
        const reader = this.proc.stdout.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                this.buffer = Buffer.concat([this.buffer, Buffer.from(value)]);
                this.processBuffer();
            }
        } catch (e) {
            console.error("Error reading from LSP stdout:", e);
        } finally {
            this.isClosed = true;
        }
    }

    private processBuffer() {
        while (true) {
            // Check for Content-Length header
            const headerMatch = this.buffer.indexOf('\r\n\r\n');
            if (headerMatch === -1) return;

            const headerPart = this.buffer.subarray(0, headerMatch).toString();
            const lengthMatch = headerPart.match(/Content-Length: (\d+)/i);
            
            if (!lengthMatch) {
                // Invalid header? discard line?
                console.error("Invalid LSP Header:", headerPart);
                this.buffer = this.buffer.subarray(headerMatch + 4);
                continue;
            }

            const contentLength = parseInt(lengthMatch[1], 10);
            const bodyStart = headerMatch + 4;
            
            if (this.buffer.length < bodyStart + contentLength) {
                // Incomplete message
                return;
            }

            const bodyBuf = this.buffer.subarray(bodyStart, bodyStart + contentLength);
            const bodyStr = bodyBuf.toString('utf8');
            
            // Advance buffer
            this.buffer = this.buffer.subarray(bodyStart + contentLength);

            try {
                const message = JSON.parse(bodyStr);
                this.handleMessage(message);
            } catch (e) {
                console.error("Failed to parse LSP message:", e);
            }
        }
    }

    private handleMessage(msg: any) {
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
            // Response to a request
            const handler = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
                handler.reject(msg.error);
            } else {
                handler.resolve(msg.result);
            }
        } else {
            // Notification or request from server -> ignore for this tool for now
            // console.log("Received notification:", msg.method);
        }
    }

    sendRequest<T>(method: string, params: any): Promise<T> {
        const id = this.nextId++;
        const msg = {
            jsonrpc: "2.0",
            id,
            method,
            params
        };
        const json = JSON.stringify(msg);
        const content = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
        
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            if (this.proc && this.proc.stdin) {
                if (typeof this.proc.stdin === 'number') {
                    reject(new Error("STDIN is a file descriptor, expected stream"));
                    return;
                }
                const writer = this.proc.stdin;
                writer.write(new TextEncoder().encode(content));
                writer.flush();
            } else {
                reject(new Error("LSP process not running"));
            }
        });
    }

    sendNotification(method: string, params: any) {
        const msg = {
            jsonrpc: "2.0",
            method,
            params
        };
        const json = JSON.stringify(msg);
        const content = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
        
        if (this.proc && this.proc.stdin) {
            if (typeof this.proc.stdin === 'number') return;
            const writer = this.proc.stdin;
            writer.write(new TextEncoder().encode(content));
            writer.flush();
        }
    }

    async getSemanticTokens(uri: string, text: string, languageId: string = 'plaintext'): Promise<SemanticTokens | null> {
        // Open
        this.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId, 
                version: 1,
                text
            }
        });

        // Request tokens
        try {
            const result = await this.sendRequest<SemanticTokens>('textDocument/semanticTokens/full', {
                textDocument: { uri }
            });
            return result;
        } catch (e) {
            console.error("Semantic tokens request failed:", e);
            return null;
        }
    }

    async shutdown() {
        if (!this.proc) return;

        try {
            await this.sendRequest('shutdown', {});
            this.sendNotification('exit', {});
        } catch (e) {
            console.error("Error during LSP shutdown:", e);
        } finally {
            this.kill();
        }
    }

    kill() {
        if (this.proc) {
            this.proc.kill();
        }
    }
}
