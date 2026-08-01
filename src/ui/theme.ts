import { ReaderPrefs } from '../types';

export const C = {
  ink: '#132E35',
  ink2: '#203D42',
  sea: '#63AAA5',
  seaPale: '#C6DDDA',
  paper: '#E9ECE5',
  text: '#172A2D',
  muted: '#65767A',
  line: '#CBD2CC',
  white: '#F8FAF6',
  ember: '#D8895B',
};

export const BOOK_COVER_ASPECT_RATIO = 0.71;

export function getReaderPalette(theme: ReaderPrefs['theme']) {
  if (theme === 'night') return { bg: '#142428', bar: '#1A2E32', surface: '#1B3034', surfaceAlt: '#223A3E', control: '#263F43', text: '#E3E9E3', muted: '#9AAEAD', line: '#385055', accent: '#8CB9B2', focus: '#2C4347', scrim: 'rgba(3,10,12,.76)', onAccent: '#102629' };
  if (theme === 'mist') return { bg: '#DCE8E6', bar: '#E6EFED', surface: '#EDF3F1', surfaceAlt: '#D5E3E0', control: '#F5F8F6', text: '#183034', muted: '#607779', line: '#B8CAC6', accent: '#466E82', focus: '#CBDCE2', scrim: 'rgba(13,35,38,.54)', onAccent: '#F7FBF8' };
  if (theme === 'wheat') return { bg: '#F0DEB7', bar: '#F6E8CB', surface: '#F8EBCF', surfaceAlt: '#EAD6AC', control: '#FFF5DE', text: '#211A12', muted: '#776851', line: '#D3BA8D', accent: '#97552F', focus: '#E4C99D', scrim: 'rgba(40,27,13,.55)', onAccent: '#FFF8E9' };
  return { bg: C.paper, bar: '#EEF0EB', surface: '#F4F6F1', surfaceAlt: '#E3E9E3', control: '#FAFBF8', text: C.text, muted: C.muted, line: C.line, accent: '#34756F', focus: '#DCE8E3', scrim: 'rgba(4,18,21,.58)', onAccent: '#F8FAF6' };
}

export type ReaderPalette = ReturnType<typeof getReaderPalette>;
