const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:<mime>;base64,<data>" — strip the prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Converts a File object to a Claude API content block.
 * Also attaches a `name` field for UI display (not sent to Claude API).
 * Throws if the file is too large or unsupported.
 */
export async function fileToContentBlock(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `"${file.name}" exceeds the 5 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`
    );
  }

  if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    const data = await readAsBase64(file);
    return { type: 'image', source: { type: 'base64', media_type: file.type, data } };
  }

  if (file.type === 'application/pdf') {
    const data = await readAsBase64(file);
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }

  if (
    file.type.startsWith('text/') ||
    file.name.match(
      /\.(md|txt|csv|json|yaml|yml|toml|xml|html|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|h|sh|bash|zsh)$/i
    )
  ) {
    const text = await readAsText(file);
    return { type: 'text', text: `--- ${file.name} ---\n${text}` };
  }

  throw new Error(`"${file.name}" is not a supported file type. Use images, PDFs, or text files.`);
}
