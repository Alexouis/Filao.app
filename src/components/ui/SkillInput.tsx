import { Plus, X } from "lucide-react";
import React, { useState } from 'react';

export const SkillInput = ({
  selectedSkills = [],
  availableSkills,
  isAdmin,
  isReadOnly = false,
  variant = 'light',
  onAdd,
  onRemove
}: {
  selectedSkills: string[],
  availableSkills: string[],
  isAdmin: boolean,
  isReadOnly?: boolean,
  variant?: 'dark' | 'light',
  onAdd: (s: string) => void,
  onRemove: (s: string) => void
}) => {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Debug
  console.log("SkillInput Render:", { availableSkills, selectedSkills, inputValue, showSuggestions });

  // Filter options: if input is empty, show all available (that aren't selected)
  const filteredOptions = availableSkills.filter(
    skill =>
      skill.toLowerCase().includes(inputValue.toLowerCase()) &&
      !selectedSkills.includes(skill)
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAdd(inputValue);
      setInputValue("");
    } else if (e.key === 'Backspace' && inputValue === "" && selectedSkills.length > 0) {
      onRemove(selectedSkills[selectedSkills.length - 1]);
    }
  };

  const textColor = variant === 'light' ? 'text-[#0B1F38]' : 'text-white';
  const borderColor = variant === 'light' ? 'border-[#0B1F38]/10 focus-within:border-[#00A3E0]' : 'border-white/10 focus-within:border-white/40';
  const chipBg = variant === 'light' ? 'bg-[#00A3E0]/10' : 'bg-purple-600/30';
  const chipText = variant === 'light' ? 'text-[#00A3E0]' : 'text-purple-200';
  const suggestionBg = variant === 'light' ? 'bg-white border-[#0B1F38]/10 text-[#0B1F38]' : 'bg-gray-800 border-white/10 text-white/80';
  const suggestionHover = variant === 'light' ? 'hover:bg-[#00A3E0]/5 hover:text-[#00A3E0]' : 'hover:bg-white/10 hover:text-white';

  return (
    <div className="relative">
      <div className={`w-full py-2 px-3 min-h-[44px] flex flex-wrap items-center gap-2 transition-all duration-300 rounded-xl border ${borderColor} ${showSuggestions ? 'bg-white border-[#00A3E0] shadow-[0_0_0_4px_rgba(0,163,224,0.1)]' : 'bg-[#0B1F38]/5 border-[#0B1F38]/10 hover:border-[#0B1F38]/30 hover:bg-[#0B1F38]/10'}`}>

        {/* Render Selected Chips */}
        {selectedSkills.map(skill => (
          <span key={skill} className={`${chipBg} ${chipText} text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 font-bold animate-in zoom-in-50 duration-200`}>
            {skill}
            {isAdmin && !isReadOnly && <button onClick={() => onRemove(skill)} className="hover:opacity-70 transition-opacity">
              <X size={12} />
            </button>}
          </span>
        ))}

        {/* The Input Field */}
        <input
          disabled={!isAdmin || isReadOnly}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder={selectedSkills.length === 0 ? (isAdmin ? "Ajouter une compétence..." : "Aucune compétence renseignée") : ""}
          className={`bg-transparent ${textColor} text-sm focus:outline-none min-w-[120px] flex-1 font-medium transition-colors ${showSuggestions ? 'text-[#0B1F38] placeholder-[#0B1F38]/40' : 'text-[#0B1F38] placeholder-[#0B1F38]/50'}`}
        />
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestions && (inputValue || filteredOptions.length > 0) && (
        <div className={`absolute z-50 left-0 right-0 bottom-full mb-1 border rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar ${suggestionBg}`}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <button
                key={option}
                onClick={() => {
                  onAdd(option);
                  setInputValue("");
                }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${suggestionHover}`}
              >
                {option}
              </button>
            ))
          ) : (
            <button
              onClick={() => {
                onAdd(inputValue);
                setInputValue("");
              }}
              className="w-full text-left px-4 py-2 text-sm text-blue-500 hover:bg-gray-100 transition-colors flex items-center gap-2"
            >
              <Plus size={14} /> Créer "{inputValue}"
            </button>
          )}
        </div>
      )}
    </div>
  );
};