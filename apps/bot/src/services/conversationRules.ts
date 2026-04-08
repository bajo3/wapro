function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isConversationKeepAliveMessage(text: string): boolean {
  const t = normalize(text);
  if (!t || t.length > 32) return false;
  return /^(hola|hola como estas|buenas|buen dia|buenas tardes|buenas noches|ok|oki|okey|dale|listo|joya|genial|perfecto|de una|deuna|va|y|y\?|ah|aja|mmm|bueno)$/.test(t);
}

export function isSearchRefinementMessage(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return /\b(pocos km|poco kilometraje|menos km|bajo kilometraje|mas nuevo|mas barata|mas barato|mas economico|automatic[oa]|manual|nafta|diesel|gasoil|gnc|hibrid|electrico|201\d|202\d|entre \d{4} y \d{4}|del \d{4}|hasta \d{4}|con pocos)\b/.test(t);
}

export function isVehicleDetailsRequest(text: string): boolean {
  return /\b(detalles?|mas\s+detalles?|info(?:rmacion)?|ficha|datos?|contame\s+mas|decime\s+mas)\b/i.test(text);
}

export function wantsVehicleMedia(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return /\b(foto|fotos|imagen|imagenes|video|videos|mostrame foto|mandame foto|pasame foto|me mandas una foto|tenes fotos|tenes alguna foto)\b/.test(t);
}

export function buildNoStockReply(options?: {
  vehicleLabel?: string;
  allowAlternatives?: boolean;
}): string {
  const vehicleLabel = String(options?.vehicleLabel || '').trim();
  if (vehicleLabel) {
    return options?.allowAlternatives === false
      ? `Ahora mismo no tengo stock confirmado de ${vehicleLabel}.`
      : `Ahora mismo no tengo stock confirmado de ${vehicleLabel}. Si querés, te muestro lo más parecido que sí hay.`;
  }
  return options?.allowAlternatives === false
    ? 'Ahora mismo no tengo un match confirmado para eso.'
    : 'Ahora mismo no tengo un match confirmado para eso. Si querés, te muestro lo más parecido que sí hay.';
}

export function selectMentionedVehicle<T extends { brand?: string; model?: string; name?: string }>(
  text: string,
  items: T[]
): T | null {
  const wanted = normalize(text);
  if (!wanted || !Array.isArray(items) || items.length === 0) return null;

  const scored = items
    .map((item) => {
      const tokens = normalize([item.brand, item.model, item.name].filter(Boolean).join(' '))
        .split(/\s+/)
        .filter((token) => token.length >= 4);
      const score = tokens.reduce((acc, token) => acc + (wanted.includes(token) ? 1 : 0), 0);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score ? scored[0].item : null;
}
