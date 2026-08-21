import { Check } from 'lucide-react';

interface ImageSelectorProps {
  images: string[];
  selected: string | null;
  onSelect: (imageId: string) => void;
  columns?: 2 | 4;
  labels?: string[];
}

export default function ImageSelector({
  images,
  selected,
  onSelect,
  columns = 2,
  labels,
}: ImageSelectorProps) {
  const gridCols = columns === 2 ? 'grid-cols-2' : 'grid-cols-4';

  return (
    <div className={`grid ${gridCols} gap-2`}>
      {images.map((image, i) => {
        const isSelected = selected === image || selected === `U${i + 1}`;
        const label = labels?.[i] || `U${i + 1}`;

        return (
          <button
            key={i}
            onClick={() => onSelect(image)}
            className={`relative rounded-lg overflow-hidden border-2 transition-all ${
              isSelected
                ? 'border-indigo-500 ring-2 ring-indigo-400/30'
                : 'border-transparent hover:border-indigo-400/50'
            }`}
          >
            <img
              src={image}
              alt={label}
              className="w-full h-auto aspect-square object-cover"
            />

            {/* Label */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-1 text-center">
              {label}
            </div>

            {/* Selected Check */}
            {isSelected && (
              <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                <Check size={12} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
