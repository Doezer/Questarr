import GameGrid from '../GameGrid';
import { type Game } from '../GameCard';
import fantasyRpgCover from '@assets/generated_images/Fantasy_RPG_game_cover_53d6bedb.png';
import scifiShooterCover from '@assets/generated_images/Sci-fi_shooter_game_cover_44a05942.png';
import racingCover from '@assets/generated_images/Racing_game_cover_art_7a256a20.png';
import puzzleCover from '@assets/generated_images/Indie_puzzle_game_cover_d884c5f4.png';

export default function GameGridExample() {
  //todo: remove mock functionality
  const mockGames: Game[] = [
    {
      id: "1",
      title: "Elder Scrolls: Legendary Edition",
      coverImage: fantasyRpgCover,
      status: "owned",
      platforms: ["PC", "PlayStation"],
      genre: "Action RPG",
      releaseDate: "2024-03-15",
      rating: 9.2
    },
    {
      id: "2", 
      title: "Cyber Assault: Future Wars",
      coverImage: scifiShooterCover,
      status: "wishlist",
      platforms: ["PC", "Xbox"],
      genre: "FPS",
      releaseDate: "2024-06-20",
      rating: 8.5
    },
    {
      id: "3",
      title: "Neon Speed Racing",
      coverImage: racingCover,
      status: "playing",
      platforms: ["PC", "PlayStation", "Xbox"],
      genre: "Racing",
      releaseDate: "2024-01-10",
      rating: 7.8
    },
    {
      id: "4",
      title: "Pixel Adventure Quest",
      coverImage: puzzleCover,
      status: "completed",
      platforms: ["PC", "Switch", "Mobile"],
      genre: "Puzzle Platformer",
      releaseDate: "2023-11-05",
      rating: 8.9
    }
  ];

  return <GameGrid games={mockGames} title="Sample Game Collection" />;
}