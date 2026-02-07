import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import chalk from 'chalk';

export interface ThemeColor {
    foreground?: string;
    fontStyle?: string; // italic, bold, underline
}

interface ThemeRule {
    scope?: string | string[];
    settings: ThemeColor;
}

    interface VSCodeTheme {
    name?: string;
    include?: string;
    type?: string; // dark | light
    colors?: Record<string, string>; // UI colors
    tokenColors?: ThemeRule[];
    semanticTokenColors?: Record<string, string | ThemeColor>;
}

export interface ThemeMatch {
    color: ThemeColor;
    matchedScopeIndex: number; // Index in the input scopes array that triggered the match. -1 if default.
}

export class ThemeResolver {
    private rules: ThemeRule[] = [];
    private semanticRules: Map<string, ThemeColor> = new Map();

    constructor(themePath: string) {
        this.loadTheme(themePath);
    }

    private loadTheme(themePath: string) {
        try {
            const content = fs.readFileSync(themePath, 'utf8');
            const theme = JSON5.parse(content) as VSCodeTheme;
            
            // Handle inheritance (include property)
            // Load base theme first so that current theme can override
            if (theme.include) {
                const baseThemePath = path.resolve(path.dirname(themePath), theme.include);
                // Simple cycle detection could be added here if needed, but keeping it simple for now
                this.loadTheme(baseThemePath);
            }

            if (theme.tokenColors) {
                // Append user rules (they override defaults due to order if specificity is same, 
                // but we strictly rely on our match logic which should respect order)
                this.rules.push(...theme.tokenColors);
            }

            if (theme.semanticTokenColors) {
                for (const [key, value] of Object.entries(theme.semanticTokenColors)) {
                    const settings = typeof value === 'string' 
                        ? { foreground: value } 
                        : value;
                    this.semanticRules.set(key, settings);
                }
            }
        } catch (e) {
            console.error(chalk.red(`Failed to load theme from ${themePath}:`), e);
        }
    }

    getBracketColors(): string[] {
        // VS Code Default Dark+ Bracket Colors
        // These are the defaults if the theme doesn't override editorBracketHighlight.foreground*
        // We could look into this.semanticRules or this.rules, but usually these are in 'colors' (workbench colors)
        // which we parse but don't fully utilize yet.
        
        // TODO: specific check in this.rules/colors for overrides
        return ["#FFD700", "#DA70D6", "#179FFF"];
    }

    /**
     * Resolve a semantic token to a color.
     * Follows VS Code's precedence:
     * 1. precise type.modifier
     * 2. type
     * 3. wildcard *.modifier
     */
    resolveSemantic(tokenType: string, modifiers: string[]): ThemeColor | null {
        // 1. Try "type.modifier" (taking the first matching modifier for simplicity, 
        // ideally should match all combinations but usually one dominant modifier is styled)
        // VS Code actually scores them. We'll iterate all modifiers.
        for (const mod of modifiers) {
            const key = `${tokenType}.${mod}`;
            if (this.semanticRules.has(key)) return this.semanticRules.get(key)!;
        }

        // 2. Try "type"
        if (this.semanticRules.has(tokenType)) {
            return this.semanticRules.get(tokenType)!;
        }

        // 3. Try "*.modifier"
        for (const mod of modifiers) {
            const key = `*.${mod}`;
            if (this.semanticRules.has(key)) return this.semanticRules.get(key)!;
        }

        return null;
    }

    /**
     * Matches a scope stack against the theme rules.
     * Returns the resolved color settings.
     * 
     * VS Code Logic:
     * 1. Match against each scope in the stack (from specific to general).
     * 2. Find the rule with the highest "specificity".
     * 3. Specificity is determined by how well the rule matches the scope.
     * 
     * Simplified implementation:
     * We iterate the rules. For each rule, we check if it matches the current scope.
     * We track the "best" match.
     */
    resolve(scopes: string[]): ThemeMatch {
        // Iterate backwards through the scope stack (from leaf to root)
        // Find the first scope that matches a rule.
        
        for (let i = scopes.length - 1; i >= 0; i--) {
            const scope = scopes[i];
            
            let bestMatchForScope: ThemeColor | null = null;
            let bestScoreForScope = -1;

            for (const rule of this.rules) {
                if (!rule.scope) continue;
                
                const ruleScopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
                
                for (const selector of ruleScopes) {
                    // Check if targetScope starts with selector
                    // e.g. target="variable.parameter.ts", selector="variable" -> Match
                    if (scope.startsWith(selector)) {
                        // Check strict prefix boundary
                        if (scope.length === selector.length || scope[selector.length] === '.') {
                            const score = selector.length;
                            if (score >= bestScoreForScope) {
                                bestScoreForScope = score;
                                bestMatchForScope = rule.settings;
                            }
                        }
                    }
                }
            }

            // If we found a match for this scope, return it.
            // Child scopes override parent scopes.
            if (bestMatchForScope) {
                return { color: bestMatchForScope, matchedScopeIndex: i };
            }
        }

        return { color: { foreground: "#D4D4D4" }, matchedScopeIndex: -1 };
    }
}
