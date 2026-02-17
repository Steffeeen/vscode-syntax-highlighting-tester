import { LspClient } from './src/lsp/client.js';
import fs from 'node:fs';

const command = ["/Users/steffen/dev/swift-vscode-fix/sourcekit-lsp/.build/arm64-apple-macosx/debug/sourcekit-lsp"];
const rootUri = "file:///Users/steffen/Desktop/ExampleSwiftProject";
const fileUri = "file:///Users/steffen/Desktop/ExampleSwiftProject/Sources/ExampleSwiftProject/Example1.swift";

async function runTest(tokenTypes: string[]) {
    console.log(`\n=== Testing with tokenTypes: ${tokenTypes.length ? JSON.stringify(tokenTypes) : '[] (Default)'} ===`);
    
    const client = new LspClient(command);
    
    // Set capabilities before starting
    client.capabilities = {
        textDocument: {
            semanticTokens: {
                dynamicRegistration: false,
                tokenTypes: tokenTypes,
                tokenModifiers: [],
                formats: ['relative'],
                requests: {
                    range: false,
                    full: { delta: false }
                }
            }
        }
    };

    try {
        await client.start(rootUri);
        console.log("LSP Started");

        // Read file content
        const filePath = fileUri.replace('file://', '');
        const text = fs.readFileSync(filePath, 'utf-8');

        // Request tokens
        const tokens = await client.getSemanticTokens(fileUri, text, 'swift');
        
        if (tokens && tokens.data) {
            console.log(`Received ${tokens.data.length / 5} tokens.`);
            
            if (client.legend) {
                console.log("Legend tokenTypes:", client.legend.tokenTypes);
                
                // Helper to decode tokens
                const decodeToken = (typeIdx: number, modIdx: number) => {
                    const type = client.legend!.tokenTypes[typeIdx] || `unknown(${typeIdx})`;
                    const modifiers: string[] = [];
                    client.legend!.tokenModifiers.forEach((mod, i) => {
                        if (modIdx & (1 << i)) modifiers.push(mod);
                    });
                    return { type, modifiers };
                };

                // Print tokens for specific lines (197-204)
                // Note: Semantic tokens are relative, so we need to track current line/char
                let currentLine = 0;
                let currentChar = 0;
                
                console.log("\n--- Tokens for lines 197-204 ---");
                for (let i = 0; i < tokens.data.length; i += 5) {
                    const deltaLine = tokens.data[i];
                    const deltaStart = tokens.data[i+1];
                    const length = tokens.data[i+2];
                    const typeIdx = tokens.data[i+3];
                    const modIdx = tokens.data[i+4];
                    
                    currentLine += deltaLine;
                    if (deltaLine > 0) currentChar = 0;
                    currentChar += deltaStart;
                    
                    if (currentLine >= 196 && currentLine <= 203) { // 0-indexed, so 196 is line 197
                        const { type, modifiers } = decodeToken(typeIdx, modIdx);
                        const tokenText = text.split('\n')[currentLine].substring(currentChar, currentChar + length);
                        console.log(`Line ${currentLine + 1}: "${tokenText}" -> ${type} [${modifiers.join(', ')}] (idx: ${typeIdx})`);
                    }
                }
                console.log("--------------------------------\n");

                const macroIndex = client.legend.tokenTypes.indexOf('macro');
                const modifierIndex = client.legend.tokenTypes.indexOf('modifier');
                const decoratorIndex = client.legend.tokenTypes.indexOf('decorator');
                
                console.log(`Index of 'macro': ${macroIndex}`);
                console.log(`Index of 'modifier': ${modifierIndex}`);
                console.log(`Index of 'decorator': ${decoratorIndex}`);
                
                // Let's count how many tokens use these indices
                let macroCount = 0;
                let modifierCount = 0;
                let decoratorCount = 0;
                
                for (let i = 0; i < tokens.data.length; i += 5) {
                    const typeIdx = tokens.data[i+3];
                    if (typeIdx === macroIndex) macroCount++;
                    if (typeIdx === modifierIndex) modifierCount++;
                    if (typeIdx === decoratorIndex) decoratorCount++;
                }
                
                console.log(`Tokens using 'macro': ${macroCount}`);
                console.log(`Tokens using 'modifier': ${modifierCount}`);
                console.log(`Tokens using 'decorator': ${decoratorCount}`);
            }
        } else {
            console.log("No tokens received.");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.shutdown();
    }
}

// 1. Test with empty list (current behavior) -> Should show 'macro' usage if server defaults to full list
await runTest([]);

// 2. Test with restricted list (mimicking VS Code if it excludes 'macro')
// Common restricted list found in some VS Code configs
const restrictedList = [
    "namespace", "type", "class", "enum", "interface", "struct", 
    "typeParameter", "parameter", "variable", "property", "enumMember", 
    "event", "function", "method", "keyword", "modifier", "comment", 
    "string", "number", "regexp", "operator" 
    // Notice 'macro' and 'decorator' are missing
];
await runTest(restrictedList);
