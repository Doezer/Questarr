import GameCard from '../GameCard';
import fantasyRpgCover from '@assets/generated_images/Fantasy_RPG_game_cover_53d6bedb.png';

export default function GameCardExample() {
  const sampleGame = {
    id: "1",
    title: "Elder Scrolls: Legendary Edition",
    coverImage: fantasyRpgCover,
    status: "owned" as const,
    platforms: ["PC", "PlayStation"] as const,
    genre: "Action RPG",
    releaseDate: "2024-03-15",
    rating: 9.2
  };

  return (
    <div className="w-64">
      <GameCard game={sampleGame} />
    </div>
  );
}