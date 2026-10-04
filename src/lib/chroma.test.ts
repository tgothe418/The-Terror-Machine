import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  buildChromaMap,
  chromaSegments,
  CHROMA_PALETTE,
  type ChromaEntry,
} from './chroma';
import type { Blueprint } from '../types';

interface SpanProps {
  children?: React.ReactNode;
  style?: { color?: string };
  className?: string;
}
type ChromaElement = React.ReactElement<SpanProps>;

describe('buildChromaMap', () => {
  it('includes signature word entry when authored, absent otherwise', () => {
    const withSignature = {
      cast: [],
      topology: { nodeDefinitions: [] },
      chromaSignature: { word: 'House', color: '#ff0000' },
    } as unknown as Blueprint;

    const mapWith = buildChromaMap(withSignature);
    expect(mapWith).toHaveLength(1);
    expect(mapWith[0]).toEqual({ pattern: 'House', color: '#ff0000' });

    const withoutSignature = {
      cast: [],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const mapWithout = buildChromaMap(withoutSignature);
    expect(mapWithout).toHaveLength(0);
  });

  it('signature noun takes priority over cast member duplicates', () => {
    const blueprint = {
      chromaSignature: { word: 'Eddie', color: '#111111' },
      cast: [
        { name: 'Eddie', chroma: '#222222' },
      ],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const map = buildChromaMap(blueprint);
    expect(map).toHaveLength(1);
    expect(map[0]).toEqual({ pattern: 'Eddie', color: '#111111' });
  });

  it('maps cast members with palette cycling and custom chroma override', () => {
    const blueprint = {
      cast: [
        { name: 'Member Zero' },
        { name: 'Member One', chroma: '#custom1' },
        { name: 'Member Two' },
      ],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const map = buildChromaMap(blueprint);
    // Member Zero + alias Member
    // Member One + alias skipped (Member collides with Member Zero's first name)
    // Member Two + alias skipped
    expect(map.find((e) => e.pattern === 'Member Zero')?.color).toBe(CHROMA_PALETTE[0]);
    expect(map.find((e) => e.pattern === 'Member One')?.color).toBe('#custom1');
    expect(map.find((e) => e.pattern === 'Member Two')?.color).toBe(CHROMA_PALETTE[2]);
  });

  it('skips cast members with empty or whitespace names', () => {
    const blueprint = {
      cast: [
        { name: '' },
        { name: '   ' },
        { name: 'Valid Cast' },
      ],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const map = buildChromaMap(blueprint);
    expect(map.some((e) => e.pattern === 'Valid Cast')).toBe(true);
    expect(map.filter((e) => !e.pattern.trim())).toHaveLength(0);
  });

  it('adds first-name alias only when unambiguous; skips on collision', () => {
    // Unambiguous case
    const unambiguous = {
      cast: [
        { name: 'Eddie Marsh' },
        { name: 'Sarah Porter' },
      ],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const mapUnambiguous = buildChromaMap(unambiguous);
    expect(mapUnambiguous.map((e) => e.pattern)).toEqual([
      'Eddie Marsh',
      'Eddie',
      'Sarah Porter',
      'Sarah',
    ]);

    // Collision case: two cast members with same first name
    const collisionSameFirst = {
      cast: [
        { name: 'Eddie Marsh' },
        { name: 'Eddie Porter' },
      ],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const mapCollision1 = buildChromaMap(collisionSameFirst);
    expect(mapCollision1.map((e) => e.pattern)).toEqual([
      'Eddie Marsh',
      'Eddie Porter',
    ]);
    expect(mapCollision1.some((e) => e.pattern === 'Eddie')).toBe(false);

    // Collision case: first name matches another member's full name
    const collisionWithFullName = {
      cast: [
        { name: 'Eddie Marsh' },
        { name: 'Eddie' },
      ],
      topology: { nodeDefinitions: [] },
    } as unknown as Blueprint;

    const mapCollision2 = buildChromaMap(collisionWithFullName);
    // Eddie Marsh is added. Its first name 'Eddie' collides with member 2's full name 'Eddie', so alias is skipped.
    // Member 2 full name 'Eddie' is added with member 2's color.
    expect(mapCollision2.map((e) => e.pattern)).toEqual([
      'Eddie Marsh',
      'Eddie',
    ]);
    expect(mapCollision2.find((e) => e.pattern === 'Eddie')?.color).toBe(CHROMA_PALETTE[1]);
  });

  it('skips node pattern colliding with cast name (case-insensitive)', () => {
    const blueprint = {
      cast: [
        { name: 'Chapel' },
        { name: 'Eddie Marsh' },
      ],
      topology: {
        nodeDefinitions: [
          { id: 'node-1', label: 'chapel', name: 'Chapel Nave' },
          { id: 'node-2', label: 'eddie', name: 'West Wing' },
          { id: 'node-3', label: 'Basement', name: 'Cellar', id_field: 'node-3' },
        ],
      },
    } as unknown as Blueprint;

    const map = buildChromaMap(blueprint);
    const patterns = map.map((e) => e.pattern.toLowerCase());
    // 'chapel' collides with cast 'Chapel'
    expect(patterns.filter((p) => p === 'chapel')).toHaveLength(1);
    // 'eddie' collides with cast alias 'Eddie'
    expect(patterns.filter((p) => p === 'eddie')).toHaveLength(1);
    // 'Chapel Nave' is not colliding
    expect(map.some((e) => e.pattern === 'Chapel Nave')).toBe(true);
    // 'Basement', 'Cellar', 'node-3' are not colliding
    expect(map.some((e) => e.pattern === 'Basement')).toBe(true);
    expect(map.some((e) => e.pattern === 'Cellar')).toBe(true);
  });

  it('skips node patterns shorter than 3 characters', () => {
    const blueprint = {
      cast: [],
      topology: {
        nodeDefinitions: [
          { id: 'n1', label: 'A', name: 'AB', description: 'desc' },
          { id: 'node-safe', label: 'Kitchen' },
        ],
      },
    } as unknown as Blueprint;

    const map = buildChromaMap(blueprint);
    expect(map.some((e) => e.pattern === 'A')).toBe(false);
    expect(map.some((e) => e.pattern === 'AB')).toBe(false);
    expect(map.some((e) => e.pattern === 'Kitchen')).toBe(true);
    expect(map.some((e) => e.pattern === 'node-safe')).toBe(true);
  });

  it('handles empty or null blueprint gracefully', () => {
    expect(buildChromaMap(null as unknown as Blueprint)).toEqual([]);
    expect(buildChromaMap({} as unknown as Blueprint)).toEqual([]);
  });
});

describe('chromaSegments', () => {
  it('empty map returns text unchanged as a single string element', () => {
    const text = 'The corridors stretched into the dark.';
    const result = chromaSegments(text, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('empty text returns [text] unchanged', () => {
    const result = chromaSegments('', [{ pattern: 'Eddie', color: '#e8c25a' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('');
  });

  it('longest pattern wins ("Eddie Marsh" beats "Eddie")', () => {
    const map: ChromaEntry[] = [
      { pattern: 'Eddie', color: '#e8c25a' },
      { pattern: 'Eddie Marsh', color: '#e08a3c' },
    ];

    const text = 'Eddie Marsh walked through the doorway, but Eddie stayed behind.';
    const segments = chromaSegments(text, map);

    // Expect 4 segments:
    // 1. span: "Eddie Marsh" (#e08a3c)
    // 2. string: " walked through the doorway, but "
    // 3. span: "Eddie" (#e8c25a)
    // 4. string: " stayed behind."
    expect(segments).toHaveLength(4);

    const first = segments[0] as ChromaElement;
    expect(React.isValidElement(first)).toBe(true);
    expect(first.props.children).toBe('Eddie Marsh');
    expect(first.props.style?.color).toBe('#e08a3c');
    expect(first.props.className).toBe('ttm-chroma');
    expect(first.key).toBe('chroma-0');

    expect(segments[1]).toBe(' walked through the doorway, but ');

    const third = segments[2] as ChromaElement;
    expect(React.isValidElement(third)).toBe(true);
    expect(third.props.children).toBe('Eddie');
    expect(third.props.style?.color).toBe('#e8c25a');
    expect(third.key).toBe('chroma-1');

    expect(segments[3]).toBe(' stayed behind.');
  });

  it('case-insensitive match ("eddie" matches pattern "Eddie")', () => {
    const map: ChromaEntry[] = [
      { pattern: 'Eddie', color: '#e8c25a' },
    ];

    const text = 'eddie turned to look at EDDIE.';
    const segments = chromaSegments(text, map);

    expect(segments).toHaveLength(4);

    const first = segments[0] as ChromaElement;
    expect(first.props.children).toBe('eddie'); // Original casing preserved
    expect(first.props.style?.color).toBe('#e8c25a');

    expect(segments[1]).toBe(' turned to look at ');

    const third = segments[2] as ChromaElement;
    expect(third.props.children).toBe('EDDIE'); // Original casing preserved
    expect(third.props.style?.color).toBe('#e8c25a');

    expect(segments[3]).toBe('.');
  });

  it('respects word boundaries ("Eddies" does not match "Eddie"; "Room 6" matches inside "the Room 6 door")', () => {
    const map: ChromaEntry[] = [
      { pattern: 'Eddie', color: '#e8c25a' },
      { pattern: 'Room 6', color: '#b48ac9' },
    ];

    const text = 'Eddies gathered outside the Room 6 door while Room 60 remained quiet.';
    const segments = chromaSegments(text, map);

    // "Eddies" -> no match (followed by letter 's')
    // "Room 6" inside "the Room 6 door" -> matches
    // "Room 60" -> no match (followed by number '0')
    const spans = segments.filter((s): s is ChromaElement => React.isValidElement(s));
    expect(spans).toHaveLength(1);
    expect(spans[0].props.children).toBe('Room 6');
    expect(spans[0].props.style?.color).toBe('#b48ac9');

    // Make sure 'Eddies' and 'Room 60' remain in the plain string parts
    const joined = segments.map((s) => (React.isValidElement<SpanProps>(s) ? s.props.children : s)).join('');
    expect(joined).toBe(text);
  });

  it('produces no nested spans on repeated or adjacent matches', () => {
    const map: ChromaEntry[] = [
      { pattern: 'Eddie', color: '#e8c25a' },
      { pattern: 'Marsh', color: '#e08a3c' },
    ];

    const text = 'Eddie, Marsh, Eddie.';
    const segments = chromaSegments(text, map);

    expect(segments).toHaveLength(6);
    // span(Eddie), string(', '), span(Marsh), string(', '), span(Eddie), string('.')
    expect(React.isValidElement(segments[0])).toBe(true);
    expect((segments[0] as ChromaElement).props.children).toBe('Eddie');
    expect(segments[1]).toBe(', ');
    expect(React.isValidElement(segments[2])).toBe(true);
    expect((segments[2] as ChromaElement).props.children).toBe('Marsh');
    expect(segments[3]).toBe(', ');
    expect(React.isValidElement(segments[4])).toBe(true);
    expect((segments[4] as ChromaElement).props.children).toBe('Eddie');
    expect(segments[5]).toBe('.');

    // Verify none of the spans have React elements as children
    for (const seg of segments) {
      if (React.isValidElement<SpanProps>(seg)) {
        expect(typeof seg.props.children).toBe('string');
      }
    }
  });

  it('escapes regex metacharacters in patterns safely', () => {
    const map: ChromaEntry[] = [
      { pattern: 'Dr. Marsh', color: '#e8c25a' },
      { pattern: 'Unit [A]', color: '#6ea8d8' },
    ];

    const text = 'Consult Dr. Marsh at Unit [A] today.';
    const segments = chromaSegments(text, map);

    const spans = segments.filter((s): s is ChromaElement => React.isValidElement(s));
    expect(spans).toHaveLength(2);
    expect(spans[0].props.children).toBe('Dr. Marsh');
    expect(spans[1].props.children).toBe('Unit [A]');
  });
});
