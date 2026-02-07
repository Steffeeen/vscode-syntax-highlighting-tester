import fs from 'node:fs';
import { StyledRange } from './overlay/merger.js';

export class Renderer {
    static saveJson(ranges: StyledRange[], path: string) {
        fs.writeFileSync(path, JSON.stringify(ranges, null, 2));
    }

    static renderHtml(ranges: StyledRange[], path: string, themeName: string = "Visualized") {
        let htmlContent = '';
        let currentLine = 0;
        
        for (const r of ranges) {
            while (currentLine < r.startLine) {
                htmlContent += '\n'; // Pre tag handles newlines
                currentLine++;
            }
            const style = `color: ${r.foreground};${r.fontStyle?.includes('italic') ? ' font-style: italic;' : ''}${r.fontStyle?.includes('bold') ? ' font-weight: bold;' : ''}${r.fontStyle?.includes('underline') ? ' text-decoration: underline;' : ''}`;
            
            // Encode data attributes for the tooltip
            const sourceAttr = r.source;
            const scopesAttr = r.scopes.join(', ').replace(/"/g, '&quot;');
            const foregroundAttr = r.foreground;
            const scopeColorsAttr = r.scopeColors ? r.scopeColors.join(',') : '';
            const activeIndexAttr = r.activeScopeIndex !== undefined ? r.activeScopeIndex : -1;
            
             const text = r.text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
            
            htmlContent += `<span style="${style}" data-source="${sourceAttr}" data-scopes="${scopesAttr}" data-foreground="${foregroundAttr}" data-scope-colors="${scopeColorsAttr}" data-active-index="${activeIndexAttr}">${text}</span>`;
        }

        const template = `
<!DOCTYPE html>
<html>
<head>
    <title>Syntax Highlight Test - ${themeName}</title>
    <style>
        body { background-color: #1e1e1e; color: #d4d4d4; font-family: 'Menlo', 'Monaco', 'Courier New', monospace; margin: 20px; }
        pre { white-space: pre; line-height: 1.5; }
        span { cursor: text; }
        span:hover { outline: 1px solid rgba(255,255,255,0.3); }
        
        #tooltip {
            position: fixed;
            display: none;
            background: #252526;
            border: 1px solid #454545;
            color: #cccccc;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.4);
            z-index: 1000;
            pointer-events: none;
            max-width: 500px;
            white-space: pre-wrap;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        }
        .tooltip-label { color: #888; }
        .tooltip-val { 
            color: #4fc1ff;
            display: flex;
            flex-flow: wrap column;
            gap: 2px;
        }
        .textmate-scope-gray { color: #888; }
        .active-scope { color: #4fc1ff; font-weight: bold; }
        .color-swatch {
            display: inline-block;
            width: 10px;
            height: 10px;
            border: 1px solid #555;
            margin-right: 6px;
            vertical-align: middle;
        }
        .scope-row {
            display: flex;
            align-items: center;
        }
    </style>
</head>
<body>
    <h2>Syntax Test: ${themeName}</h2>
    <pre><code>${htmlContent}</code></pre>
    <div id="tooltip"></div>

    <script>
        const tooltip = document.getElementById('tooltip');
        const codeBlock = document.querySelector('pre');

        codeBlock.addEventListener('mouseover', (e) => {
            if (e.target.tagName === 'SPAN' && e.target.hasAttribute('data-scopes')) {
                const source = e.target.getAttribute('data-source');
                const scopes = e.target.getAttribute('data-scopes');
                const foreground = e.target.getAttribute('data-foreground');
                const scopeColorsStr = e.target.getAttribute('data-scope-colors') || '';
                const activeIndexStr = e.target.getAttribute('data-active-index');
                const activeIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -1;
                
                const scopeList = scopes.split(',').map(s => s.trim());
                const colorList = scopeColorsStr.split(','); 
                
                let html = '';
                
                // Color Info
                html += '<span class="tooltip-label">Foreground:</span> <span class="tooltip-val" style="display: inline-block; color: #ccc;">';
                html += '<span class="color-swatch" style="background-color: ' + foreground + ';"></span>';
                html += '<span style="vertical-align: middle;">' + foreground + '</span>';
                html += '</span><br>';

                // Helper to render a scope with its color
                const renderScope = (scope, color, index, isGray = false) => {
                    let swatch = '';
                    if (color && color !== '') {
                        swatch = '<span class="color-swatch" style="background-color: ' + color + ';"></span>';
                    }
                    
                    let className = 'scope-row';
                    if (index === activeIndex) {
                        className += ' active-scope';
                    } else if (isGray) {
                        className += ' textmate-scope-gray';
                    }

                    return '<div class="' + className + '">' + swatch + '<span>' + scope + '</span></div>';
                };

                if (source === 'semantic') {
                    // Split into semantic and textmate
                    // We look for our special separator
                    const sepIdx = scopeList.indexOf('__TM_SCOPES__');
                    
                    if (sepIdx !== -1) {
                         const semanticParts = scopeList.slice(0, sepIdx);
                         const semanticColors = colorList.slice(0, sepIdx);
                         
                         const tmParts = scopeList.slice(sepIdx + 1);
                         const tmColors = colorList.slice(sepIdx + 1);
                         
                         // Indices need to account for separation
                         // semantic indices: 0 to sepIdx-1
                         // tm indices: sepIdx+1 to end
                         
                         html += '<span class="tooltip-label">Source:</span> <span class="tooltip-val">' + source + '</span><br>';
                         html += '<span class="tooltip-label">Semantic Token Type:</span> <div class="tooltip-val">';
                         semanticParts.forEach((s, i) => html += renderScope(s, semanticColors[i], i, false));
                         html += '</div><br>';
                         
                         html += '<span class="tooltip-label">TextMate Scopes:</span> <div class="tooltip-val">';
                         // Reverse for display hierarchy
                         // We need the original index to match activeIndex
                         for (let i = tmParts.length - 1; i >= 0; i--) {
                             const originalIndex = sepIdx + 1 + i;
                             html += renderScope(tmParts[i], tmColors[i], originalIndex, true);
                         }
                         html += '</div>';
                    } else {
                         // Fallback
                         html += '<span class="tooltip-label">Source:</span> <span class="tooltip-val">' + source + '</span><br>';
                         html += '<span class="tooltip-label">Scopes:</span> <div class="tooltip-val">';
                         scopeList.forEach((s, i) => html += renderScope(s, colorList[i], i));
                         html += '</div>';
                    }
                } else {
                     // Standard TextMate
                     html += '<span class="tooltip-label">Source:</span> <span class="tooltip-val">' + source + '</span><br>';
                     html += '<span class="tooltip-label">Scopes:</span> <div class="tooltip-val">';
                     for (let i = scopeList.length - 1; i >= 0; i--) {
                         // All are potentially gray except active one
                         html += renderScope(scopeList[i], colorList[i], i, true);
                     }
                     html += '</div>';
                }

                tooltip.innerHTML = html;
                
                tooltip.style.display = 'block';
                updatePosition(e);
            }
        });

        codeBlock.addEventListener('mousemove', (e) => {
             if (tooltip.style.display === 'block') {
                updatePosition(e);
             }
        });

        codeBlock.addEventListener('mouseout', (e) => {
            if (e.target.tagName === 'SPAN') {
                tooltip.style.display = 'none';
            }
        });

        function updatePosition(e) {
            const offset = 15;
            // Prevent going off screen
            let left = e.clientX + offset;
            let top = e.clientY + offset;
            
            if (left + tooltip.offsetWidth > window.innerWidth) {
                left = e.clientX - tooltip.offsetWidth - offset;
            }
            if (top + tooltip.offsetHeight > window.innerHeight) {
                top = e.clientY - tooltip.offsetHeight - offset;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        }
    </script>
</body>
</html>`;

        fs.writeFileSync(path, template);
    }
}
