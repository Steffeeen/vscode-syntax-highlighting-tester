// dummy-lsp.ts
import { 
    InitializeResult 
} from 'vscode-languageserver-protocol';

const stdin = process.stdin;
const stdout = process.stdout;

let buffer = Buffer.alloc(0);

stdin.on('data', (chunk) => {
    const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, chunkBuf]);
    processBuffer();
});

function processBuffer() {
    while (true) {
        const headerMatch = buffer.indexOf('\r\n\r\n');
        if (headerMatch === -1) return;

        const headerPart = buffer.subarray(0, headerMatch).toString();
        const lengthMatch = headerPart.match(/Content-Length: (\d+)/i);
        if (!lengthMatch) return;

        const contentLength = parseInt(lengthMatch[1], 10);
        const bodyStart = headerMatch + 4;
        
        if (buffer.length < bodyStart + contentLength) return;

        const bodyBuf = buffer.subarray(bodyStart, bodyStart + contentLength);
        const bodyStr = bodyBuf.toString('utf8');
        buffer = buffer.subarray(bodyStart + contentLength);

        try {
            const msg = JSON.parse(bodyStr);
            handleMessage(msg);
        } catch (e) {
            console.error(e);
        }
    }
}

function send(msg: any) {
    const json = JSON.stringify(msg);
    const content = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
    stdout.write(content);
}

function handleMessage(msg: any) {
    if (msg.method === 'initialize') {
        const result: InitializeResult = {
            capabilities: {
                semanticTokensProvider: {
                    legend: {
                        tokenTypes: ['variable', 'function'],
                        tokenModifiers: ['declaration', 'readonly']
                    },
                    full: true
                }
            }
        };
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result
        });
    } else if (msg.method === 'textDocument/semanticTokens/full') {
        // Return some dummy tokens
        // format: line, startChar, length, tokenType, tokenModifiers
        // input: 
        // function hello "world"
        // var test
        
        // Let's mark "hello" (line 0, col 9, len 5) as function (idx 1)
        // Let's mark "test" (line 1, col 4, len 4) as variable (idx 0)
        
        const data = [
            0, 9, 5, 1, 0, // hello (function)
            1, 4, 4, 0, 1  // test (variable + declaration)
        ];
        
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: { data }
        });
    } else if (msg.method === 'shutdown') {
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: null
        });
    } else if (msg.method === 'exit') {
        process.exit(0);
    }
}
