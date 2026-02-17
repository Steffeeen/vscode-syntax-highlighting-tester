import { SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver-protocol';
import { TextMateEngine, Token as TmToken } from '../textmate/grammar.js';
import { ThemeResolver, ThemeColor } from '../theme/resolver.js';

export interface StyledRange {
    startLine: number;
    startChar: number;
    endLine: number; // usually same as startLine for simple tokens
    endChar: number;
    text: string;
    
    // Resolved Styles
    foreground: string;
    fontStyle?: string;
    
    // Metadata for debugging
    source: 'textmate' | 'semantic';
    scopes: string[]; // TextMate scopes or Semantic Token Type
    scopeColors?: string[]; // Resolved color for each individual scope
    activeScopeIndex?: number; // Index of the scope in 'scopes' that provided the color
}

// Internal state for a single character before merging
interface TokenInputState {
    tmScopes: string[];
    semantic?: {
        type: string;
        modifiers: string[];
    };
}

interface ResolvedStyle {
    foreground: string;
    fontStyle?: string;
    source: 'textmate' | 'semantic';
    scopes: string[];
    scopeColors: string[];
    activeScopeIndex: number;
}

// Default mapping from Standard LSP Token Types to TextMate scopes
// Used when the theme doesn't explicit semanticTokenColors
// https://github.com/microsoft/vscode/blob/1aa235610cf3a1cea299d2c8a5f1bc80f33027c1/src/vs/platform/theme/common/tokenClassificationRegistry.ts#L545
const STANDARD_TOKEN_MAP: Record<string, string[]> = {
    "comment": ["comment"],
    "string": ["string"],
    "keyword": ["keyword.control"],
    "number": ["constant.numeric"],
    "regexp": ["constant.regexp"],
    "operator": ["keyword.operator"],
    "namespace": ["entity.name.namespace"],
    "type": ["entity.name.type", "support.type"],
    "type.defaultLibrary": ["support.type"],
    "struct": ["entity.name.type.struct"],
    "class": ["entity.name.type.class", "support.class"],
    "class.defaultLibrary": ["support.class"],
    "interface": ["entity.name.type.interface"],
    "enum": ["entity.name.type.enum"],
    "typeParameter": ["entity.name.type.parameter"],
    "function": ["entity.name.function", "support.function"],
    "function.defaultLibrary": ["support.function"],
    "member.defaultLibrary": ["support.function"],
    "method": ["entity.name.function.member", "support.function"],
    "macro": ["entity.name.function.preprocessor"],
    "variable": ["variable.other.readwrite", "entity.name.variable"],
    "variable.readonly": ["variable.other.constant"],
    "variable.defaultLibrary.readonly": ["support.constant"],
    "parameter": ["variable.parameter"],
    "property": ["variable.other.property"],
    "property.readonly": ["variable.other.constant.property"],
    "property.defaultLibrary.readonly": ["support.constant.property"],
    "enumMember": ["variable.other.enummember"],
    "event": ["variable.other.event"],
    "decorator": ["entity.name.decorator", "entity.name.function"],

    // FIXME: these cases are not present in the vscode source code but when using the
    // SourceKit LSP vscode shows modifier semantic tokens (for example `@Lazy`) as
    // getting their color from `keyword.control`
    "modifier": ["keyword.control"], 
};

export class TokenMerger {
    constructor(
        private tmEngine: TextMateEngine,
        private theme: ThemeResolver
    ) {}

    private getStandardFallbackScope(type: string, modifiers: string[]): string[] | undefined {
        const defaultLibPart = modifiers.includes('defaultLibrary') ? '.defaultLibrary' : '';
        const readOnlyPart = modifiers.includes('readonly') ? '.readonly' : '';
        const key = type + defaultLibPart + readOnlyPart;
        return STANDARD_TOKEN_MAP[key] || STANDARD_TOKEN_MAP[type + readOnlyPart] || STANDARD_TOKEN_MAP[type + defaultLibPart] || STANDARD_TOKEN_MAP[type];
    }

    merge(content: string, tmTokens: TmToken[], semanticTokens: SemanticTokens | null, legend?: SemanticTokensLegend | null): StyledRange[] {
        const lines = content.split(/\r\n|\r|\n/);
        const output: StyledRange[] = [];

        // 1. Parse Semantic Tokens
        const semanticMap = this.parseSemanticTokens(semanticTokens, legend);

        // 2. Process each line
        for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            const lineLen = lineText.length;
            
            // Empty line handling
            if (lineLen === 0) {
                output.push({
                    startLine: i, startChar: 0, endLine: i, endChar: 0,
                    text: '', foreground: '', source: 'textmate', scopes: [], scopeColors: []
                });
                continue;
            }

            // A. Build Input State Buffer
            const lineState: TokenInputState[] = new Array(lineLen).fill(null).map(() => ({
                tmScopes: []
            }));

            // B. Apply TextMate Scopes to Buffer
            const lineTmTokens = tmTokens.filter(t => t.line === i);
            for (const t of lineTmTokens) {
                for (let k = t.startIndex; k < t.endIndex && k < lineLen; k++) {
                    lineState[k].tmScopes = t.scopes;
                }
            }

            // C. Apply Semantic Tokens to Buffer
            const lineSemTokens = semanticMap.get(i);
            if (lineSemTokens) {
                for (const t of lineSemTokens) {
                    for (let k = t.start; k < t.end && k < lineLen; k++) {
                        lineState[k].semantic = {
                            type: t.type,
                            modifiers: t.modifiers
                        };
                    }
                }
            }

            // D. Resolve Styles and Compress
            let currentStart = 0;
            let currentStyle = this.resolveStyle(lineState[0]);

            for (let k = 1; k < lineLen; k++) {
                const nextStyle = this.resolveStyle(lineState[k]);
                
                // Check for equality to compress
                if (this.areStylesEqual(currentStyle, nextStyle)) {
                    continue;
                }

                // Push segment
                output.push({
                    startLine: i,
                    startChar: currentStart,
                    endLine: i,
                    endChar: k,
                    text: lineText.substring(currentStart, k),
                    foreground: currentStyle.foreground,
                    fontStyle: currentStyle.fontStyle,
                    source: currentStyle.source,
                    scopes: currentStyle.scopes,
                    scopeColors: currentStyle.scopeColors,
                    activeScopeIndex: currentStyle.activeScopeIndex
                });

                currentStart = k;
                currentStyle = nextStyle;
            }

            // Push last segment
            output.push({
                startLine: i,
                startChar: currentStart,
                endLine: i,
                endChar: lineLen,
                text: lineText.substring(currentStart, lineLen),
                foreground: currentStyle.foreground,
                fontStyle: currentStyle.fontStyle,
                source: currentStyle.source,
                scopes: currentStyle.scopes,
                scopeColors: currentStyle.scopeColors,
                activeScopeIndex: currentStyle.activeScopeIndex
            });
        }

        // 3. Apply Bracket Pair Colorization (Post-Processing)
        return this.applyBracketPairColorization(output);
    }

    private applyBracketPairColorization(tokens: StyledRange[]): StyledRange[] {
        const bracketColors = this.theme.getBracketColors();
        const stack: string[] = []; // Stores opening brackets: '(', '[', '{'
        
        // We need to split tokens if they contain mixed content including brackets
        // But first, let's flatten the list to handle splits easier
        const expandedTokens: StyledRange[] = [];

        for (const token of tokens) {
            // Check if token is in a scope that ignores brackets (strings, comments, regex)
            // But allow brackets inside embedded contents (interpolations)
            const hasString = token.scopes.some(s => s.includes('string'));
            const hasComment = token.scopes.some(s => s.includes('comment'));
            const hasRegex = token.scopes.some(s => s.includes('regex'));
            
            const isEmbedded = token.scopes.some(s => 
                s.includes('embedded') || 
                s.includes('interpolation') ||
                // Special case for some languages where punctuation doesn't say 'embedded' explicitly 
                // but the grammar breaks out of string.
                // However, usually 'embedded' or 'interpolation' is present.
                // One common pattern is punctuation.section.embedded...
                s.includes('punctuation.section.embedded')
            );

            // Safe if:
            // 1. Not a comment AND
            // 2. Not a regex AND
            // 3. (Not a string OR (Is a string AND Is embedded))
            const isSafeScope = !hasComment && !hasRegex && (!hasString || isEmbedded);

            if (!isSafeScope || token.text.length === 0) {
                expandedTokens.push(token);
                continue;
            }

            // Scan for brackets in the token text
            const matches = [...token.text.matchAll(/[\(\)\[\]\{\}]/g)];
            
            if (matches.length === 0) {
                expandedTokens.push(token);
                continue;
            }

            // We have brackets, we must split this token
            let lastIdx = 0;
            for (const match of matches) {
                const idx = match.index!;
                const char = match[0];

                // Push content before bracket
                if (idx > lastIdx) {
                    expandedTokens.push({
                        ...token,
                        startChar: token.startChar + lastIdx,
                        endChar: token.startChar + idx,
                        text: token.text.substring(lastIdx, idx)
                    });
                }

                // Determine Bracket Color
                let color = token.foreground;
                let activeScopeIndex = token.activeScopeIndex; // Keep original scope index? 
                // Actually, VS Code bracket coloring overrides standard token coloring.
                // But we don't have a "scope" for it in the stack. 
                // We'll just force the foreground color.
                
                if (['(', '[', '{'].includes(char)) {
                    // Opening
                    const depth = stack.length;
                    color = bracketColors[depth % bracketColors.length];
                    stack.push(char);
                } else {
                    // Closing
                    // Try to pop matching
                    const last = stack.length > 0 ? stack[stack.length - 1] : null;
                    let isValidPair = false;
                    if (char === ')' && last === '(') isValidPair = true;
                    if (char === ']' && last === '[') isValidPair = true;
                    if (char === '}' && last === '{') isValidPair = true;

                    if (isValidPair) {
                        stack.pop();
                        const depth = stack.length; // Use depth of the pair (which is current length after pop)
                        color = bracketColors[depth % bracketColors.length];
                    } else {
                        // Mismatch or empty stack. 
                        // VS Code usually colors it "unexpected" (often red) or just leaves it.
                        // We'll leave it as original color for now, or maybe default bracket color?
                        // Let's stick to original token color to indicate broken structure/fallback.
                    }
                }

                // Push bracket token
                expandedTokens.push({
                    ...token,
                    startChar: token.startChar + idx,
                    endChar: token.startChar + idx + 1,
                    text: char,
                    foreground: color,
                    // We append a virtual scope for the tooltip
                    scopes: [...token.scopes, "bracket-pair-colorization"],
                    scopeColors: token.scopeColors ? [...token.scopeColors, color] : undefined,
                    activeScopeIndex: token.scopes.length // Point to our new virtual scope
                });

                lastIdx = idx + 1;
            }

            // Push content after last bracket
            if (lastIdx < token.text.length) {
                expandedTokens.push({
                    ...token,
                    startChar: token.startChar + lastIdx,
                    endChar: token.endChar,
                    text: token.text.substring(lastIdx)
                });
            }
        }

        return expandedTokens;
    }

    private resolveStyle(state: TokenInputState): ResolvedStyle {
        const tmScopes = state.tmScopes;
        const semantic = state.semantic;

        // Base TextMate Color
        const tmMatch = this.theme.resolve(tmScopes);
        
        // If no semantic token, just return TM
        if (!semantic) {
            const tmScopeColors = tmScopes.map(s => this.resolveScopeColor(s));
            // tmMatch.matchedScopeIndex is relative to tmScopes
            // Since scopes == tmScopes, it maps 1:1
            return {
                foreground: tmMatch.color.foreground || '#D4D4D4',
                fontStyle: tmMatch.color.fontStyle,
                source: 'textmate',
                scopes: tmScopes,
                scopeColors: tmScopeColors,
                activeScopeIndex: tmMatch.matchedScopeIndex
            };
        }

        // Semantic Resolution Logic
        let finalColor: ThemeColor | null = null;
        let finalSource: 'textmate' | 'semantic' = 'semantic';
        let activeIndex = -1;

        // FIXME: debug why this hack is needed
        // Fix for SourceKit-LSP: attributes like @Test are reported as 'macro', 
        // but VS Code displays them as 'modifier' because they are attributes.
        // We detect this via TextMate scope context.
        if (semantic.type === 'macro' && tmScopes.some(s => s.includes('attribute'))) {
            semantic.type = 'modifier';
        }

        const finalScopes: string[] = [semantic.type];
        
        if (semantic.modifiers.length > 0) {
            finalScopes.push(`modifiers: ${semantic.modifiers.join(',')}`);
        }

        // 1. Try explicit theme semanticTokenColors
        const explicitColor = this.theme.resolveSemantic(semantic.type, semantic.modifiers);
        
        // 2. Try Standard Fallback
        let fallbackScopes: string[] | undefined;
        let standardColor: ThemeColor | null = null;
        
        if (!explicitColor) {
            fallbackScopes = this.getStandardFallbackScope(semantic.type, semantic.modifiers);
            if (fallbackScopes) {
                // We treat this fallback resolution like a "TextMate" resolution 
                // because it matches a scope.
                
                const fallbackMatch = this.theme.resolve(fallbackScopes);
                standardColor = fallbackMatch.color;
            }
        }

        // Decision Tree
        if (explicitColor) {
            finalColor = explicitColor;
            activeIndex = 0; // Semantic type is always at 0
            if (fallbackScopes) {
                 finalScopes.push(`(fallback to standard scope: ${fallbackScopes.join(', ')})`);
            }
        } else if (standardColor) {
             finalColor = standardColor;
             if (fallbackScopes) {
                 finalScopes.push(`(fallback to standard scope: ${fallbackScopes.join(', ')})`);
                 // The fallback scope hint is just added
                 activeIndex = finalScopes.length - 1;
             }
        } else {
             // Fallback to TextMate
             finalColor = tmMatch.color;
             finalScopes.push('(fallback to TextMate color)');
             // Now append TM Scopes... we need to calculate index later
        }

        // Append TM Scopes for reference
        finalScopes.push('__TM_SCOPES__');
        const tmStartIndex = finalScopes.length;
        finalScopes.push(...tmScopes);

        // If we fell back to TM, calculate the active index now
        if (!explicitColor && !standardColor) {
             if (tmMatch.matchedScopeIndex !== -1) {
                 activeIndex = tmStartIndex + tmMatch.matchedScopeIndex;
             }
        }

        // Resolve Colors for Tooltip
        const scopeColors = finalScopes.map(s => {
             if (s === '__TM_SCOPES__' || s.startsWith('modifiers:')) return '';
             
             // Special case: show color for fallback scope hint
             if (s.startsWith('(fallback to standard scope:')) {
                 const match = s.match(/: (.*)\)/);
                 if (match) return this.resolveScopeColor(match[1]);
                 return '';
             }
             if (s.startsWith('(fallback')) return '';

             return this.resolveScopeColor(s);
        });

        return {
            foreground: finalColor?.foreground || '#D4D4D4',
            fontStyle: finalColor?.fontStyle,
            source: finalSource,
            scopes: finalScopes,
            scopeColors: scopeColors,
            activeScopeIndex: activeIndex
        };
    }

    private resolveScopeColor(scope: string): string {
        return this.theme.resolve([scope]).color.foreground || '#D4D4D4';
    }

    private areStylesEqual(a: ResolvedStyle, b: ResolvedStyle): boolean {
        return (
            a.foreground === b.foreground &&
            a.fontStyle === b.fontStyle &&
            a.source === b.source &&
            a.activeScopeIndex === b.activeScopeIndex &&
            JSON.stringify(a.scopes) === JSON.stringify(b.scopes)
        );
    }

    private parseSemanticTokens(tokens: SemanticTokens | null, legend?: SemanticTokensLegend | null) {
        const map = new Map<number, { start: number, end: number, type: string, modifiers: string[] }[]>();
        
        if (tokens && tokens.data) {
            let line = 0;
            let char = 0;
            const data = tokens.data;
            
            for (let i = 0; i < data.length; i += 5) {
                const deltaLine = data[i];
                const deltaStart = data[i+1];
                const length = data[i+2];
                const tokenTypeIdx = data[i+3];
                const tokenMod = data[i+4];
                
                if (deltaLine > 0) {
                    line += deltaLine;
                    char = deltaStart;
                } else {
                    char += deltaStart;
                }
                
                const tokenType = this.lookupTokenType(tokenTypeIdx, legend); 
                const tokenModifiers = this.lookupTokenModifiers(tokenMod, legend);

                if (!map.has(line)) {
                    map.set(line, []);
                }
                map.get(line)!.push({
                    start: char,
                    end: char + length,
                    type: tokenType,
                    modifiers: tokenModifiers
                });
            }
        }
        return map;
    }

    private lookupTokenType(idx: number, legend?: SemanticTokensLegend | null): string {
        if (legend && legend.tokenTypes[idx]) {
            return legend.tokenTypes[idx];
        }

        const defaultLegend = [
            'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 
            'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 
            'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 
            'regexp', 'operator', 'decorator'
        ];
        return defaultLegend[idx] || 'unknown';
    }

    private lookupTokenModifiers(modBitmask: number, legend?: SemanticTokensLegend | null): string[] {
        const modifiers: string[] = [];
        if (legend && legend.tokenModifiers) {
            for (let i = 0; i < legend.tokenModifiers.length; i++) {
                if (modBitmask & (1 << i)) {
                    modifiers.push(legend.tokenModifiers[i]);
                }
            }
        }
        return modifiers;
    }
}
