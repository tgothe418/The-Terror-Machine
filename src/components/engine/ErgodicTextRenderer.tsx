import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { ChromaEntry, chromaSegments } from '../../lib/chroma';

interface ErgodicTextRendererProps {
  id?: string;
  text: string;
  psychologicalStatus?: string;
  isStreaming?: boolean;
  chromaMap?: ChromaEntry[];
}

export default function ErgodicTextRenderer({
  id,
  text,
  psychologicalStatus = 'Stable',
  chromaMap,
}: ErgodicTextRendererProps) {
  const isPanic =
    psychologicalStatus.toLowerCase().includes('panic') ||
    psychologicalStatus.toLowerCase().includes('terror');
  const isExhausted =
    psychologicalStatus.toLowerCase().includes('exhaustion') ||
    psychologicalStatus.toLowerCase().includes('tired');

  const displayText = text;

  // Memoize processed text to prevent random shifts on re-renders
  const processedText = useMemo(() => {
    let result = displayText;
    if (isPanic) {
      const paragraphs = displayText.split('\n\n');
      result = paragraphs
        .map((p, i) => {
          // Use paragraph index and text length as a deterministic seed
          const seedValue = (p.length + i) % 10;
          if (seedValue > 7 && i < paragraphs.length - 1) {
            return p + '\n\n\n\n';
          }
          return p;
        })
        .join('\n\n');
    }
    return result;
  }, [displayText, isPanic]);

  const renderedContent = useMemo(() => {
    return chromaMap && chromaMap.length > 0
      ? chromaSegments(processedText, chromaMap)
      : processedText;
  }, [processedText, chromaMap]);

  const containerClasses = `text-sm sm:text-base leading-relaxed whitespace-pre-wrap transition-colors duration-1000 ${
    isExhausted ? 'text-zinc-400' : 'text-zinc-100'
  }`;

  return (
    <motion.div
      key={id || text.substring(0, 20)} // Use an ID, or safely fallback to a static substring, NEVER the full mutating text
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{
        opacity: 1,
        scale: 1,
        x: isPanic ? [0, -4, 4, -4, 4, -2, 2, 0] : 0,
        filter: isPanic ? ['blur(4px)', 'blur(2px)', 'blur(0px)'] : 'blur(0px)',
        backgroundColor: isPanic
          ? ['rgba(220, 38, 38, 0)', 'rgba(220, 38, 38, 0.05)', 'rgba(220, 38, 38, 0)']
          : 'rgba(0,0,0,0)',
      }}
      transition={{
        x: isPanic
          ? { duration: 0.8, times: [0, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1] }
          : { duration: 0.5 },
        filter: { duration: 3, ease: 'easeOut' },
        backgroundColor: { duration: 2 },
        opacity: { duration: 1 },
        scale: { duration: 0.5 },
      }}
      style={{ willChange: isPanic ? 'transform, filter, opacity' : 'auto' }} // Hardware acceleration flag
      className={containerClasses}
    >
      {renderedContent}
    </motion.div>
  );
}
