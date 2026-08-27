import { en } from "../locales/en";

interface Props {
  offsets: number[];
  selectedOffset: number;
  onSelect: (offset: number) => void;
}

export function TimeControl({ offsets, selectedOffset, onSelect }: Props) {
  return (
    <div className="time-control" role="group" aria-label="Forecast hour">
      {offsets.map((offset) => (
        <button
          key={offset}
          className={offset === selectedOffset ? "time-btn selected" : "time-btn"}
          onClick={() => onSelect(offset)}
        >
          {offset === 0 ? en.timeNow : en.timePlusHour(offset)}
        </button>
      ))}
    </div>
  );
}
