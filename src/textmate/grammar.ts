import fs from 'node:fs';
import path from 'node:path';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

// Locate onig.wasm in node_modules
// In a real bundled app, this might need adjustment, but for a dev tool this works.
const wasmPath = path.join(import.meta.dir, '../../node_modules/vscode-oniguruma/release/onig.wasm');

// Lazy initialization of WASM
let wasmInitialized = false;

async function initWasm() {
    if (wasmInitialized) return;
    
    if (!fs.existsSync(wasmPath)) {
        throw new Error(`Could not find onig.wasm at ${wasmPath}`);
    }

    const wasmBin = fs.readFileSync(wasmPath);
    await oniguruma.loadWASM(wasmBin);
    wasmInitialized = true;
}

export interface Token {
    line: number;
    startIndex: number;
    endIndex: number;
    scopes: string[];
}

export class TextMateEngine {
    private registry: vsctm.Registry | null = null;
    private grammar: vsctm.IGrammar | null = null;

    constructor(
        private grammarPath: string, 
        private scopeName: string,
        private extraGrammars: Record<string, string> = {}
    ) {}

    async init() {
        await initWasm();

        this.registry = new vsctm.Registry({
            onigLib: Promise.resolve({
                createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
                createOnigString: (str) => new oniguruma.OnigString(str)
            }),
            loadGrammar: async (scopeName) => {
                if (scopeName === this.scopeName) {
                    // Load the main grammar
                    const content = fs.readFileSync(this.grammarPath, 'utf8');
                    return vsctm.parseRawGrammar(content, this.grammarPath);
                }
                
                // Check extra grammars
                if (this.extraGrammars[scopeName]) {
                     const extraPath = this.extraGrammars[scopeName];
                     if (fs.existsSync(extraPath)) {
                         const content = fs.readFileSync(extraPath, 'utf8');
                         return vsctm.parseRawGrammar(content, extraPath);
                     } else {
                         console.warn(`Warning: Extra grammar for scope '${scopeName}' not found at '${extraPath}'`);
                     }
                }
                
                return null;
            }
        });

        this.grammar = await this.registry.loadGrammar(this.scopeName);
        if (!this.grammar) {
            throw new Error(`Failed to load grammar for scope ${this.scopeName}`);
        }
    }

    tokenize(content: string): Token[] {
        if (!this.grammar) {
            throw new Error("Grammar not initialized. Call init() first.");
        }

        const lines = content.split(/\r\n|\r|\n/);
        let ruleStack: vsctm.StateStack | null = vsctm.INITIAL;
        const tokens: Token[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineTokens = this.grammar.tokenizeLine(line, ruleStack);
            ruleStack = lineTokens.ruleStack;

            for (const t of lineTokens.tokens) {
                tokens.push({
                    line: i,
                    startIndex: t.startIndex,
                    endIndex: t.endIndex,
                    scopes: t.scopes
                });
            }
        }

        return tokens;
    }
}
