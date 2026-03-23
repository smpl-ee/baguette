import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function loadPrompt(promptName, replacements = {}) {
  const templatePath = path.join(__dirname, `${promptName}.md`);
  let template = await fs.promises.readFile(templatePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    template = template.replaceAll(`{{${key}}}`, value);
  }
  return template;
}
