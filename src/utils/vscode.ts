
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function findVsCodeThemeDir(): string | null {
    const platform = os.platform();
    
    const candidates: string[] = [];

    // 1. Environment Variable Override
    if (process.env.VSCODE_PATH) {
        // User provided root of VSCode, we append the rest
        // Try both "resources/app/..." (installed) and just the path itself if they pointed to the themes dir
        candidates.push(path.join(process.env.VSCODE_PATH, 'resources/app/extensions/theme-defaults/themes'));
        candidates.push(path.join(process.env.VSCODE_PATH, 'Contents/Resources/app/extensions/theme-defaults/themes'));
        candidates.push(process.env.VSCODE_PATH);
    }

    // 2. Platform specific defaults
    if (platform === 'darwin') {
        candidates.push('/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/theme-defaults/themes');
        candidates.push('/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/theme-defaults/themes');
        candidates.push(path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/extensions/theme-defaults/themes'));
    } else if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            candidates.push(path.join(localAppData, 'Programs', 'Microsoft VS Code', 'resources', 'app', 'extensions', 'theme-defaults', 'themes'));
            candidates.push(path.join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'resources', 'app', 'extensions', 'theme-defaults', 'themes'));
        }
        const programFiles = process.env['ProgramFiles'];
        if (programFiles) {
             candidates.push(path.join(programFiles, 'Microsoft VS Code', 'resources', 'app', 'extensions', 'theme-defaults', 'themes'));
        }
    } else if (platform === 'linux') {
        candidates.push('/usr/share/code/resources/app/extensions/theme-defaults/themes');
        candidates.push('/usr/share/code-insiders/resources/app/extensions/theme-defaults/themes');
        candidates.push('/opt/visual-studio-code/resources/app/extensions/theme-defaults/themes');
        // Snap? Flatpak? Those are harder, but this covers standard deb/rpm installs
    }

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}
