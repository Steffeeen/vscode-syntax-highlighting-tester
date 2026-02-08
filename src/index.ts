import fs from 'node:fs';
import path from 'node:path';
import { program } from 'commander';
import chalk from 'chalk';
import JSON5 from 'json5';

import { TextMateEngine } from './textmate/grammar.js';
import { LspClient } from './lsp/client.js';
import { ThemeResolver } from './theme/resolver.js';
import { TokenMerger } from './overlay/merger.js';
import { Renderer } from './renderer.js';

import assert from 'node:assert';

interface Config {
    grammar: string;
    scopeName: string;
    extraGrammars?: Record<string, string>;
    lsp: {
        command: string[];
        rootUri?: string;
    };
    theme: string;
    files: string[];
    outDir?: string;
    snapshotDir?: string;
}

program
    .description('CLI to test syntax highlighting (TextMate + Semantic Tokens)');

program.command('diff')
    .description('Generate a visual diff between two token JSON files')
    .argument('<snapshot>', 'Path to snapshot JSON')
    .argument('<generated>', 'Path to generated JSON')
    .argument('[output]', 'Output HTML path')
    .action((snapshotPath, generatedPath, outputPath) => {
        const absSnapshotPath = path.resolve(snapshotPath);
        const absGeneratedPath = path.resolve(generatedPath);
        
        if (!fs.existsSync(absSnapshotPath)) {
            console.error(chalk.red(`Snapshot file not found: ${absSnapshotPath}`));
            process.exit(1);
        }
        if (!fs.existsSync(absGeneratedPath)) {
            console.error(chalk.red(`Generated file not found: ${absGeneratedPath}`));
            process.exit(1);
        }

        const snapshotContent = JSON.parse(fs.readFileSync(absSnapshotPath, 'utf8'));
        const generatedContent = JSON.parse(fs.readFileSync(absGeneratedPath, 'utf8'));
        
        const outPath = outputPath ? path.resolve(outputPath) : path.join(process.cwd(), 'diff.html');
        
        Renderer.renderDiffHtml(snapshotContent, generatedContent, outPath, "Snapshot", "Generated");
        console.log(chalk.green(`Diff generated at: ${outPath}`));
    });

program
    .argument('<config>', 'Path to configuration JSON file')
    .option('--verify', 'Verify generated tokens against snapshots')
    .option('--update', 'Update snapshots')
    .action(async (configPath, options) => {
        const absConfigPath = path.resolve(configPath);
        if (!fs.existsSync(absConfigPath)) {
            console.error(chalk.red(`Config file not found: ${absConfigPath}`));
            process.exit(1);
        }

        const configBaseDir = path.dirname(absConfigPath);
        const configContent = fs.readFileSync(absConfigPath, 'utf8');
        let config: Config;
        
        try {
            config = JSON5.parse(configContent);
        } catch (e) {
            console.error(chalk.red("Failed to parse config file:"), e);
            process.exit(1);
        }

        // Resolve paths relative to config file
        const resolve = (p: string) => path.resolve(configBaseDir, p);
        
        const grammarPath = resolve(config.grammar);
        
        const extraGrammars: Record<string, string> = {};
        if (config.extraGrammars) {
            for (const [scope, pathRel] of Object.entries(config.extraGrammars)) {
                extraGrammars[scope] = resolve(pathRel);
            }
        }

        let themePath = config.theme;
        // If it looks like a path (ends in .json) or contains path separators, try to resolve it.
        // Otherwise, pass it as-is to the resolver (which handles default theme names).
        if (themePath.endsWith('.json') || themePath.includes('/') || themePath.includes('\\')) {
             themePath = resolve(config.theme);
        }

        const outDir = config.outDir ? resolve(config.outDir) : path.join(configBaseDir, 'out');
        const snapshotDir = config.snapshotDir ? resolve(config.snapshotDir) : path.join(configBaseDir, 'snapshots');

        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        
        if (options.update && !fs.existsSync(snapshotDir)) {
            fs.mkdirSync(snapshotDir, { recursive: true });
        }

        console.log(chalk.blue("Initializing engines..."));

        // 1. TextMate
        const tmEngine = new TextMateEngine(grammarPath, config.scopeName, extraGrammars);
        await tmEngine.init();

        // 2. Theme
        const themeResolver = new ThemeResolver(themePath);

        // 3. LSP
        const lspClient = new LspClient(config.lsp.command);
        console.log(chalk.blue(`Starting LSP: ${config.lsp.command.join(' ')}`));
        
        try {
            await lspClient.start(config.lsp.rootUri || `file://${configBaseDir}`);
        } catch (e) {
            console.error(chalk.red("Failed to start LSP:"), e);
            process.exit(1);
        }

        // 4. Merger
        const merger = new TokenMerger(tmEngine, themeResolver);

        let hasError = false;

        // 5. Process Files
        for (const fileRel of config.files) {
            const filePath = resolve(fileRel);
            if (!fs.existsSync(filePath)) {
                console.warn(chalk.yellow(`Skipping missing file: ${filePath}`));
                continue;
            }

            console.log(chalk.green(`Processing ${fileRel}...`));
            const content = fs.readFileSync(filePath, 'utf8');
            const fileUri = `file://${filePath}`;

            // A. TextMate
            const tmTokens = tmEngine.tokenize(content);

            // B. Semantic
            // Infer language ID from scope name (e.g. source.swift -> swift)
            const langId = config.scopeName.split('.').pop() || 'plaintext';
            const semanticTokens = await lspClient.getSemanticTokens(fileUri, content, langId);
            if (!semanticTokens) {
                console.warn(chalk.yellow(`  No semantic tokens returned for ${fileRel}`));
            }

            // C. Merge
            const result = merger.merge(content, tmTokens, semanticTokens, lspClient.legend);

            // D. Output
            const baseName = path.basename(filePath);
            const jsonPath = path.join(outDir, `${baseName}.tokens.json`);
            const htmlPath = path.join(outDir, `${baseName}.html`);
            const snapshotPath = path.join(snapshotDir, `${baseName}.tokens.json`);

            Renderer.saveJson(result, jsonPath);
            Renderer.renderHtml(result, htmlPath, config.theme || "Default Dark+");
            
            console.log(`  Generated: ${jsonPath}`);
            console.log(`  Generated: ${htmlPath}`);

            // E. Snapshots
            if (options.update) {
                Renderer.saveJson(result, snapshotPath);
                console.log(chalk.cyan(`  Updated snapshot: ${snapshotPath}`));
            } else if (options.verify) {
                if (!fs.existsSync(snapshotPath)) {
                    console.error(chalk.red(`  ❌ Missing snapshot: ${snapshotPath}`));
                    hasError = true;
                } else {
                    const expectedContent = fs.readFileSync(snapshotPath, 'utf8');
                    const actualContent = JSON.stringify(result, null, 2);
                    
                    try {
                        // Normalize by parsing both (handles line ending diffs in JSON file vs memory string)
                        const expectedJson = JSON.parse(expectedContent);
                        const actualJson = JSON.parse(actualContent);
                        assert.deepStrictEqual(actualJson, expectedJson);
                        console.log(chalk.green(`  ✅ Snapshot verified`));
                    } catch (e) {
                        console.error(chalk.red(`  ❌ Snapshot mismatch for ${baseName}`));
                        // Generate Diff
                        const diffPath = path.join(outDir, `${baseName}.diff.html`);
                        try {
                            const expectedJson = JSON.parse(expectedContent);
                            Renderer.renderDiffHtml(expectedJson, result, diffPath, "Snapshot", "Generated");
                            console.error(chalk.yellow(`     Diff report: ${diffPath}`));
                        } catch (err) {
                            console.error(chalk.red(`     Failed to generate diff report: ${err}`));
                        }
                        console.error(chalk.gray(`     (Use --update to overwrite)`));
                        hasError = true;
                    }
                }
            }
        }

        // Cleanup
        await lspClient.shutdown();
        
        if (hasError) {
            console.error(chalk.red("\nVerification failed."));
            process.exit(1);
        }

        process.exit(0);
    });

program.parse();
