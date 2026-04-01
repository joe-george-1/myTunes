const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');

// Clean and recreate dist
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Copy individual files
for (const file of ['index.html', 'style.css']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(dist, file));
}

// Copy directories recursively
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

copyDir(path.join(__dirname, 'windows'), path.join(dist, 'windows'));

console.log('Frontend assets copied to dist/');
