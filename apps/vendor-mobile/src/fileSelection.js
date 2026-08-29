function fileKey(file) {
  return [file.name, file.type, file.size, file.lastModified].join(":");
}

export function mergeSelectedFiles(currentFiles, nextFiles) {
  const merged = [];
  const seen = new Set();
  for (const file of [...currentFiles, ...nextFiles]) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged;
}
