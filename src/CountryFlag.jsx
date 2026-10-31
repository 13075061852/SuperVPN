import React from 'react';
import { Globe } from 'lucide-react';

// Bundled SVGs, not emoji or remote image requests. See /licenses/flag-icons.txt.
const flags = import.meta.glob('../node_modules/flag-icons/flags/4x3/*.svg', { eager: true, query: '?url', import: 'default' });
export function countryFlagUrl(code) {
  if (typeof code !== 'string' || !/^[a-z]{2}$/i.test(code)) return null;
  return flags[`../node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`] || null;
}
export default function CountryFlag({ code, country }) {
  const src = countryFlagUrl(code);
  return src ? <img className="country-flag" src={src} alt={`${country || code}旗帜`} width="20" height="15"/> : <Globe size={17} aria-hidden="true"/>;
}
