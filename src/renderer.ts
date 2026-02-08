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
        span[data-scopes]:hover { outline: 1px solid rgba(255,255,255,0.3); }
        
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
            if (e.target.tagName === 'SPAN' && e.target.hasAttribute('data-scopes')) {
                tooltip.style.display = 'none';
            }
        });

        function updatePosition(e) {
            const offset = 15;
            const width = tooltip.offsetWidth;
            const height = tooltip.offsetHeight;
            const winW = window.innerWidth;
            const winH = window.innerHeight;

            let left = e.clientX + offset;
            let top = e.clientY + offset;

            // Horizontal Flip: If it overflows right, place it to the left of cursor
            if (left + width > winW) {
                left = e.clientX - offset - width;
            }
            
            // Vertical Flip: If it overflows bottom, place it above cursor
            if (top + height > winH) {
                top = e.clientY - offset - height;
            }

            // Simple bounds check to prevent top/left disappearing off-screen
            if (left < 0) left = 0;
            if (top < 0) top = 0;

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // Ensure we don't have conflicting styles from previous logic
            tooltip.style.right = 'auto';
            tooltip.style.bottom = 'auto';
        }
    </script>
</body>
</html>`;

        fs.writeFileSync(path, template);
    }

    static renderDiffHtml(leftRanges: StyledRange[], rightRanges: StyledRange[], path: string, leftName: string = "Snapshot", rightName: string = "Generated") {
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

        const template = `
<!DOCTYPE html>
<html>
<head>
    <title>Syntax Highlight Diff</title>
    <style>
        body { background-color: #1e1e1e; color: #d4d4d4; font-family: 'Menlo', 'Monaco', 'Courier New', monospace; margin: 0; display: flex; height: 100vh; overflow: hidden; }
        .pane { width: 50%; padding: 20px; overflow: auto; box-sizing: border-box; }
        .pane-left { border-right: 1px solid #454545; }
        h2 { margin-top: 0; font-size: 14px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        pre { white-space: pre; line-height: 1.5; margin: 0; }
        span { cursor: text; }
        span[data-scopes]:hover { outline: 1px solid rgba(255,255,255,0.3); }
        
        .diff-changed {
            outline: 1px dashed rgba(255, 200, 0, 0.5);
            background-color: rgba(255, 200, 0, 0.1);
        }
        
        .diff-line {
            background-color: rgba(255, 255, 0, 0.04);
            width: 100%;
            display: inline-block;
        }

        #tooltip {
            box-sizing: border-box;
            overflow: hidden;
            position: fixed;
            display: none;
            background: #252526;
            border: 1px solid #454545;
            color: #cccccc;
            padding: 0;
            border-radius: 4px;
            font-size: 12px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.4);
            z-index: 1000;
            pointer-events: none;
            max-width: 800px;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        }
        .tooltip-content {
            display: flex;
        }
        .tooltip-col {
            padding: 8px 12px;
            min-width: 250px;
        }
        .tooltip-col:first-child {
            border-right: 1px solid #454545;
        }
        .tooltip-header {
            font-weight: bold;
            margin-bottom: 8px;
            color: #fff;
            border-bottom: 1px solid #444;
            padding-bottom: 4px;
        }

        .tooltip-label { color: #888; }
        .tooltip-val { color: #4fc1ff; display: flex; flex-flow: wrap column; gap: 2px; }
        .textmate-scope-gray { color: #888; }
        .active-scope { color: #4fc1ff; font-weight: bold; }
        .color-swatch { display: inline-block; width: 10px; height: 10px; border: 1px solid #555; margin-right: 6px; vertical-align: middle; }
        .scope-row { display: flex; align-items: center; }
        
        /* Highlight differences in tooltip */
        .val-diff { color: #ffaa00 !important; font-weight: bold; }
    </style>
</head>
<body>
    <div class="pane pane-left" id="pane-left">
        <h2>${leftName}</h2>
        <pre><code>${leftHtml}</code></pre>
    </div>
    <div class="pane pane-right" id="pane-right">
        <h2>${rightName}</h2>
        <pre><code>${rightHtml}</code></pre>
    </div>
    <div id="tooltip"></div>

    <script>
        const tooltip = document.getElementById('tooltip');
        const paneLeft = document.getElementById('pane-left');
        const paneRight = document.getElementById('pane-right');
        let hideTimeout;
        
        // Sync Scrolling
        let isSyncing = false;

        function syncScroll(source, target) {
            source.addEventListener('scroll', () => {
                if (!isSyncing) {
                    isSyncing = true;
                    target.scrollTop = source.scrollTop;
                    target.scrollLeft = source.scrollLeft;
                    // Reset flag after a short delay
                    window.requestAnimationFrame(() => isSyncing = false);
                }
            });
        }

        syncScroll(paneLeft, paneRight);
        syncScroll(paneRight, paneLeft);

        function getTokenData(el) {
            if (!el || el.tagName !== 'SPAN' || !el.hasAttribute('data-scopes')) return null;
            return {
                text: el.getAttribute('data-text'),
                line: parseInt(el.getAttribute('data-line')),
                start: parseInt(el.getAttribute('data-start')),
                end: parseInt(el.getAttribute('data-end')),
                source: el.getAttribute('data-source'),
                scopes: el.getAttribute('data-scopes'),
                foreground: el.getAttribute('data-foreground'),
                scopeColorsStr: el.getAttribute('data-scope-colors') || '',
                activeIndex: el.getAttribute('data-active-index') ? parseInt(el.getAttribute('data-active-index'), 10) : -1
            };
        }

        function renderTokenInfo(data, otherDataList) {
            if (!data) return '<div style="color: #888;">No token</div>';

            const scopeList = data.scopes.split(',').map(s => s.trim());
            const colorList = data.scopeColorsStr.split(','); 
            
            // Check for diffs against ANY of the overlapping tokens
            // Simplified: if there's only one overlapping token, we compare directly.
            // If multiple, it's hard to strict compare, so we just show data.
            const other = otherDataList.length === 1 ? otherDataList[0] : null;

            const isFgDiff = other && data.foreground !== other.foreground;
            const isSourceDiff = other && data.source !== other.source;

            let html = '';
            
            // Text Content
            html += '<div style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #444;">';
            html += '<span class="tooltip-label">Text: </span>';
            html += '<span style="color: ' + data.foreground + '; font-family: monospace; font-weight: bold; background-color: #1e1e1e; padding: 0 4px; border-radius: 2px;">' + data.text + '</span>';
            html += '</div>';
            
            // Color Info
            html += '<span class="tooltip-label">Foreground:</span> <span class="tooltip-val ' + (isFgDiff ? 'val-diff' : '') + '" style="display: inline-block; color: #ccc;">';
            html += '<span class="color-swatch" style="background-color: ' + data.foreground + ';"></span>';
            html += '<span style="vertical-align: middle;">' + data.foreground + '</span>';
            html += '</span><br>';

            const renderScope = (scope, color, index, isGray = false) => {
                let swatch = '';
                if (color && color !== '') {
                    swatch = '<span class="color-swatch" style="background-color: ' + color + ';"></span>';
                }
                
                let className = 'scope-row';
                if (index === data.activeIndex) {
                    className += ' active-scope';
                } else if (isGray) {
                    className += ' textmate-scope-gray';
                }

                return '<div class="' + className + '">' + swatch + '<span>' + scope + '</span></div>';
            };

            if (data.source === 'semantic') {
                const sepIdx = scopeList.indexOf('__TM_SCOPES__');
                if (sepIdx !== -1) {
                        const semanticParts = scopeList.slice(0, sepIdx);
                        const semanticColors = colorList.slice(0, sepIdx);
                        const tmParts = scopeList.slice(sepIdx + 1);
                        const tmColors = colorList.slice(sepIdx + 1);
                        
                        html += '<span class="tooltip-label">Source:</span> <span class="tooltip-val ' + (isSourceDiff ? 'val-diff' : '') + '">' + data.source + '</span><br>';
                        html += '<span class="tooltip-label">Semantic Token Type:</span> <div class="tooltip-val">';
                        semanticParts.forEach((s, i) => html += renderScope(s, semanticColors[i], i, false));
                        html += '</div><br>';
                        
                        html += '<span class="tooltip-label">TextMate Scopes:</span> <div class="tooltip-val">';
                        for (let i = tmParts.length - 1; i >= 0; i--) {
                            const originalIndex = sepIdx + 1 + i;
                            html += renderScope(tmParts[i], tmColors[i], originalIndex, true);
                        }
                        html += '</div>';
                } else {
                        html += '<span class="tooltip-label">Source:</span> <span class="tooltip-val ' + (isSourceDiff ? 'val-diff' : '') + '">' + data.source + '</span><br>';
                        html += '<span class="tooltip-label">Scopes:</span> <div class="tooltip-val">';
                        scopeList.forEach((s, i) => html += renderScope(s, colorList[i], i));
                        html += '</div>';
                }
            } else {
                    html += '<span class="tooltip-label">Source:</span> <span class="tooltip-val ' + (isSourceDiff ? 'val-diff' : '') + '">' + data.source + '</span><br>';
                    html += '<span class="tooltip-label">Scopes:</span> <div class="tooltip-val">';
                    for (let i = scopeList.length - 1; i >= 0; i--) {
                        html += renderScope(scopeList[i], colorList[i], i, true);
                    }
                    html += '</div>';
            }
            return html;
        }

        function showTooltip(e) {
            const target = e.target;
            if (target.tagName !== 'SPAN' || !target.hasAttribute('data-scopes')) return;

            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }

            const myData = getTokenData(target);
            if (!myData) return;

            // Find overlapping tokens in the other pane
            const isLeft = paneLeft.contains(target);
            const otherPane = isLeft ? paneRight : paneLeft;
            
            // Query selector is expensive, optimization: match by line attribute first
            // Note: data-line is 0-based index
            const candidates = Array.from(otherPane.querySelectorAll('span[data-line="' + myData.line + '"]'));
            
            const overlaps = candidates.filter(el => {
                const s = parseInt(el.getAttribute('data-start'));
                const e = parseInt(el.getAttribute('data-end'));
                // Overlap logic: StartA < EndB && StartB < EndA
                return myData.start < e && s < myData.end;
            });
            
            const otherDataList = overlaps.map(getTokenData).filter(d => d);

            let html = '<div class="tooltip-content">';
            
            // Left Column
            html += '<div class="tooltip-col">';
            html += '<div class="tooltip-header">${leftName}</div>';
            if (isLeft) {
                html += renderTokenInfo(myData, otherDataList);
            } else {
                 // We are hovering right, so show others (which are from left) here
                 otherDataList.forEach((d, i) => {
                     if (i > 0) html += '<hr style="border: 0; border-top: 1px dashed #444; margin: 8px 0;">';
                     html += renderTokenInfo(d, [myData]);
                 });
                 if (otherDataList.length === 0) html += '<div style="color: #888;">No corresponding token</div>';
            }
            html += '</div>';

            // Right Column
            html += '<div class="tooltip-col">';
            html += '<div class="tooltip-header">${rightName}</div>';
            if (!isLeft) {
                html += renderTokenInfo(myData, otherDataList);
            } else {
                 // We are hovering left, so show others (which are from right) here
                 otherDataList.forEach((d, i) => {
                     if (i > 0) html += '<hr style="border: 0; border-top: 1px dashed #444; margin: 8px 0;">';
                     html += renderTokenInfo(d, [myData]);
                 });
                 if (otherDataList.length === 0) html += '<div style="color: #888;">No corresponding token</div>';
            }
            html += '</div>';
            
            html += '</div>'; // End content

            const prevRect = tooltip.getBoundingClientRect();
            const wasVisible = tooltip.style.display === 'block';

            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
            updatePosition(e);
            
            if (wasVisible) {
                const newRect = tooltip.getBoundingClientRect();
                tooltip.animate([
                    { width: prevRect.width + 'px', height: prevRect.height + 'px' },
                    { width: newRect.width + 'px', height: newRect.height + 'px' }
                ], {
                    duration: 100,
                    easing: 'ease-out'
                });
            }
        }

        document.querySelectorAll('pre').forEach(el => {
            el.addEventListener('mouseover', showTooltip);
            el.addEventListener('mousemove', (e) => {
                 if (tooltip.style.display === 'block') updatePosition(e);
            });
            el.addEventListener('mouseout', (e) => {
                if (e.target.tagName === 'SPAN' && e.target.hasAttribute('data-scopes')) {
                    hideTimeout = setTimeout(() => {
                        tooltip.style.display = 'none';
                    }, 50);
                }
            });
        });

        function updatePosition(e) {
            const offset = 15;
            const width = tooltip.offsetWidth;
            const height = tooltip.offsetHeight;
            const winW = window.innerWidth;
            const winH = window.innerHeight;

            let left = e.clientX + offset;
            let top = e.clientY + offset;

            // Horizontal Flip: If it overflows right, place it to the left of cursor
            if (left + width > winW) {
                left = e.clientX - offset - width;
            }
            
            // Vertical Flip: If it overflows bottom, place it above cursor
            if (top + height > winH) {
                top = e.clientY - offset - height;
            }

            // Simple bounds check to prevent top/left disappearing off-screen
            if (left < 0) left = 0;
            if (top < 0) top = 0;

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // Ensure we don't have conflicting styles from previous logic
            tooltip.style.right = 'auto';
            tooltip.style.bottom = 'auto';
        }
    </script>
</body>
</html>`;

        fs.writeFileSync(path, template);
    }
}
