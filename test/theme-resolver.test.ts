import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { ThemeResolver } from "../src/theme/resolver";
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe("ThemeResolver", () => {
    let resolver: ThemeResolver;
    let tmpThemePath: string;

    beforeAll(() => {
        const tmpDir = os.tmpdir();
        tmpThemePath = path.join(tmpDir, 'default-test-theme.json');
        
        // create a theme with the rules that were previously in DEFAULT_DARK_PLUS
        // so that we can keep the tests checking for those standard colors
        const defaultTheme = {
            tokenColors: [
                { scope: "keyword", settings: { foreground: "#C586C0" } },
                { scope: "variable", settings: { foreground: "#9CDCFE" } },
                { scope: "variable.parameter", settings: { foreground: "#9CDCFE" } }
            ]
        };
        fs.writeFileSync(tmpThemePath, JSON.stringify(defaultTheme));
        
        resolver = new ThemeResolver(tmpThemePath);
    });

    afterAll(() => {
        if (fs.existsSync(tmpThemePath)) {
            fs.unlinkSync(tmpThemePath);
        }
    });

    it("should resolve basic TextMate scopes", () => {
        // Default Dark+ has "keyword": "#C586C0"
        const result = resolver.resolve(["source.ts", "keyword.control.ts"]);
        expect(result.color.foreground).toBe("#C586C0");
        expect(result.matchedScopeIndex).toBe(1); // keyword.control.ts is at index 1
    });

    it("should fallback to parent scope if child has no match", () => {
        // Stack: ["variable", "unknown.scope"]
        // "unknown.scope" matches nothing.
        // "variable" matches "variable".
        
        const result = resolver.resolve(["variable", "unknown.scope"]);
        expect(result.color.foreground).toBe("#9CDCFE");
        expect(result.matchedScopeIndex).toBe(0); // variable is at index 0
    });

    it("should return default if no match found", () => {
        const result = resolver.resolve(["unknown.scope"]);
        expect(result.color.foreground).toBe("#D4D4D4");
        expect(result.matchedScopeIndex).toBe(-1);
    });

    it("should prioritize deeper (child) match over parent match", () => {
        // variable -> #9CDCFE
        // keyword -> #C586C0
        
        // If we have a stack ["keyword", "variable"], it implies a variable inside a keyword (unlikely but possible in grammar)
        // variable (child) should win.
        const result = resolver.resolve(["keyword", "variable"]);
        expect(result.color.foreground).toBe("#9CDCFE");
        expect(result.matchedScopeIndex).toBe(1);
    });

    it("should respect specificity within the same scope", () => {
        const tmpDir = os.tmpdir();
        const themePath = path.join(tmpDir, 'test-theme.json');
        
        const theme = {
            tokenColors: [
                { scope: "variable", settings: { foreground: "#000000" } }, // Score 8
                { scope: "variable.parameter", settings: { foreground: "#FFFFFF" } } // Score 18
            ]
        };
        
        fs.writeFileSync(themePath, JSON.stringify(theme));
        
        const customResolver = new ThemeResolver(themePath);
        
        // Scope: "variable.parameter.ts"
        // Should match "variable.parameter" (more specific) over "variable".
        const result = customResolver.resolve(["source.ts", "variable.parameter.ts"]);
        
        expect(result.color.foreground).toBe("#FFFFFF");
        expect(result.matchedScopeIndex).toBe(1);
        
        fs.unlinkSync(themePath);
    });

     it("should match prefix correctly", () => {
         // Test that 'var' does NOT match 'variable'
         
        const tmpDir = os.tmpdir();
        const themePath = path.join(tmpDir, 'prefix-test-theme.json');
        
        const theme = {
            tokenColors: [
                { scope: "variable", settings: { foreground: "#FFFFFF" } }
            ]
        };
        fs.writeFileSync(themePath, JSON.stringify(theme));
        const customResolver = new ThemeResolver(themePath);

        const result = customResolver.resolve(["var.something"]);
        // Should not match "variable"
        expect(result.matchedScopeIndex).toBe(-1);
        expect(result.color.foreground).toBe("#D4D4D4"); // default

        fs.unlinkSync(themePath);
     });

     it("should support theme inheritance via 'include'", () => {
        const tmpDir = os.tmpdir();
        const baseThemePath = path.join(tmpDir, 'base-theme.json');
        const childThemePath = path.join(tmpDir, 'child-theme.json');

        // Base theme: defines variable -> Red
        const baseTheme = {
            tokenColors: [
                { scope: "variable", settings: { foreground: "#FF0000" } },
                { scope: "comment", settings: { foreground: "#00FF00" } }
            ]
        };
        fs.writeFileSync(baseThemePath, JSON.stringify(baseTheme));

        // Child theme: includes base, overrides comment -> Blue, adds keyword -> Yellow
        const childTheme = {
            include: "./base-theme.json",
            tokenColors: [
                { scope: "comment", settings: { foreground: "#0000FF" } },
                { scope: "keyword", settings: { foreground: "#FFFF00" } }
            ]
        };
        fs.writeFileSync(childThemePath, JSON.stringify(childTheme));

        const customResolver = new ThemeResolver(childThemePath);

        // 1. Inherited rule
        const varResult = customResolver.resolve(["variable"]);
        expect(varResult.color.foreground).toBe("#FF0000");

        // 2. Child rule
        const kwResult = customResolver.resolve(["keyword"]);
        expect(kwResult.color.foreground).toBe("#FFFF00");

        // 3. Override rule (specificity is same, so order matters. Child comes after Base)
        const commentResult = customResolver.resolve(["comment"]);
        expect(commentResult.color.foreground).toBe("#0000FF");

        fs.unlinkSync(baseThemePath);
        fs.unlinkSync(childThemePath);
     });
});
