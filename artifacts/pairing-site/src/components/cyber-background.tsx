import React, { useEffect, useState } from 'react';

export function CyberBackground() {
  const [columns, setColumns] = useState<number[]>([]);

  useEffect(() => {
    const cols = Math.floor(window.innerWidth / 20);
    setColumns(Array.from({ length: cols }, (_, i) => i));

    const handleResize = () => {
      const newCols = Math.floor(window.innerWidth / 20);
      setColumns(Array.from({ length: newCols }, (_, i) => i));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1] bg-[#030303]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      
      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#00FF41_1px,transparent_1px),linear-gradient(to_bottom,#00FF41_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-[0.03]" />

      {/* Matrix rain effect simplified with CSS */}
      <div className="absolute inset-0 flex justify-between opacity-20">
        {columns.map((i) => (
          <div
            key={i}
            className="w-[2px] h-32 bg-gradient-to-b from-transparent via-primary to-transparent matrix-column"
            style={{
              animationDuration: `${Math.random() * 3 + 2}s`,
              animationDelay: `${Math.random() * 5}s`,
              opacity: Math.random() * 0.5 + 0.1
            }}
          />
        ))}
      </div>
    </div>
  );
}
