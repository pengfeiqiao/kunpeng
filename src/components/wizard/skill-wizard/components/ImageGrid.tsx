import { useState } from 'react';
import { X } from 'lucide-react';

interface ImageGridProps {
  images: string[];
  columns?: 2 | 3 | 4;
  labels?: string[];
}

export default function ImageGrid({ images, columns = 3, labels }: ImageGridProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  }[columns];

  const handleImageClick = (image: string) => {
    setSelectedImage(image);
  };

  const handleClose = () => {
    setSelectedImage(null);
  };

  return (
    <>
      <div className={`grid ${gridCols} gap-1`}>
        {images.map((image, i) => {
          const label = labels?.[i] || `${i + 1}`;

          return (
            <button
              key={i}
              onClick={() => handleImageClick(image)}
              className="relative rounded-lg overflow-hidden border border-[rgb(var(--c-border))] hover:border-indigo-400/50 transition-colors"
            >
              <img
                src={image}
                alt={`分镜 ${label}`}
                className="w-full h-auto aspect-square object-cover"
              />

              {/* Shot Number */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-0.5 text-center">
                {label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={24} />
          </button>
          <img
            src={selectedImage}
            alt="Preview"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
