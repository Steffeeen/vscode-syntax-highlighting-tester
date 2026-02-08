import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { StyledRange } from './overlay/merger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Renderer {
    static saveJson(ranges: StyledRange[], path: string) {
        fs.writeFileSync(path, JSON.stringify(ranges, null, 2));
    }

    static renderHtml(ranges: StyledRange[], outputPath: string, themeName: string = "Visualized") {
        const templatePath = path.join(__dirname, 'templates', 'normal.ejs');
        const template = fs.readFileSync(templatePath, 'utf-8');
        
        const html = ejs.render(template, { ranges, themeName });
        fs.writeFileSync(outputPath, html);
    }

    static renderDiffHtml(leftRanges: StyledRange[], rightRanges: StyledRange[], outputPath: string, leftName: string = "Snapshot", rightName: string = "Generated") {
        const lines = Math.max(
            leftRanges.length > 0 ? leftRanges[leftRanges.length - 1].endLine + 1 : 0,
            rightRanges.length > 0 ? rightRanges[rightRanges.length - 1].endLine + 1 : 0
        );

        let leftHtml = '';
        let rightHtml = '';

        // Helper to find token at position
        const getTokenAt = (tokens: StyledRange[], line: number, char: number) => {
            return tokens.find(t => t.startLine === line && t.startChar <= char && t.endChar > char);
        };

        // Helper to compare styles (visual only)
        const stylesEqual = (t1: StyledRange | undefined, t2: StyledRange | undefined) => {
            if (!t1 && !t2) return true;
            if (!t1 || !t2) return false;
            return (
                t1.foreground === t2.foreground &&
                t1.fontStyle === t2.fontStyle
            );
        };

        const renderTokens = (tokens: StyledRange[], otherTokens: StyledRange[], isLeft: boolean) => {
            let html = '';
            
            // Group by line for performance
            const tokensByLine = new Map<number, StyledRange[]>();
            for (const t of tokens) {
                if (!tokensByLine.has(t.startLine)) tokensByLine.set(t.startLine, []);
                tokensByLine.get(t.startLine)!.push(t);
            }
            
            const otherTokensByLine = new Map<number, StyledRange[]>();
            for (const t of otherTokens) {
                if (!otherTokensByLine.has(t.startLine)) otherTokensByLine.set(t.startLine, []);
                otherTokensByLine.get(t.startLine)!.push(t);
            }

            for (let i = 0; i < lines; i++) {
                const lineTokens = tokensByLine.get(i) || [];
                const otherLineTokens = otherTokensByLine.get(i) || [];
                
                let lineHtml = '';
                let lastChar = 0;
                let lineHasDiff = false;

                for (const token of lineTokens) {
                    // Fill gap if any
                    if (token.startChar > lastChar) {
                        lineHtml += " ".repeat(token.startChar - lastChar);
                    }

                    // Check for visual diff
                    let isDiff = false;
                    // Check every character in the token to see if it matches the other side
                    for (let c = token.startChar; c < token.endChar; c++) {
                        const otherToken = getTokenAt(otherLineTokens, i, c);
                        if (!stylesEqual(token, otherToken)) {
                            isDiff = true;
                            lineHasDiff = true;
                            break;
                        }
                    }

                    const diffClass = isDiff ? ' diff-changed' : '';
                    const style = `color: ${token.foreground};${token.fontStyle?.includes('italic') ? ' font-style: italic;' : ''}${token.fontStyle?.includes('bold') ? ' font-weight: bold;' : ''}${token.fontStyle?.includes('underline') ? ' text-decoration: underline;' : ''}`;
                    const scopesAttr = token.scopes.join(', ').replace(/"/g, '&quot;');
                    const scopeColorsAttr = token.scopeColors ? token.scopeColors.join(',') : '';
                    const activeIndexAttr = token.activeScopeIndex !== undefined ? token.activeScopeIndex : -1;
                    
                    const text = token.text
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&#039;");
                    
                    lineHtml += `<span class="${diffClass}" style="${style}" data-text="${text}" data-line="${token.startLine}" data-start="${token.startChar}" data-end="${token.endChar}" data-source="${token.source}" data-scopes="${scopesAttr}" data-foreground="${token.foreground}" data-scope-colors="${scopeColorsAttr}" data-active-index="${activeIndexAttr}">${text}</span>`;
                    
                    lastChar = token.endChar;
                }
                
                if (lineHasDiff) {
                    html += `<span class="diff-line">${lineHtml}</span>\n`;
                } else {
                    html += lineHtml + '\n';
                }
            }
            return html;
        };

        leftHtml = renderTokens(leftRanges, rightRanges, true);
        rightHtml = renderTokens(rightRanges, leftRanges, false);

        const templatePath = path.join(__dirname, 'templates', 'diff.ejs');
        const template = fs.readFileSync(templatePath, 'utf-8');

        const html = ejs.render(template, { leftHtml, rightHtml, leftName, rightName });
        fs.writeFileSync(outputPath, html);
    }
}
