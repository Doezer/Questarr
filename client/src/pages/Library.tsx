import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState } from "react";
import fantasyRpgCover from '@assets/generated_images/Fantasy_RPG_game_cover_53d6bedb.png';
import scifiShooterCover from '@assets/generated_images/Sci-fi_shooter_game_cover_44a05942.png';
import racingCover from '@assets/generated_images/Racing_game_cover_art_7a256a20.png';
import puzzleCover from '@assets/generated_images/Indie_puzzle_game_cover_d884c5f4.png';

export default function Library() {
  const [searchQuery, setSearchQuery] = useState("");

  //todo: remove mock functionality
  const ownedGames: Game[] = [
    {
      id: "lib1",
      title: "Elder Scrolls: Legendary Edition",
      coverImage: fantasyRpgCover,
      status: "owned",
      platforms: ["PC", "PlayStation"],
      genre: "Action RPG",
      releaseDate: "2024-03-15",
      rating: 9.2
    },
    {
      id: "lib2",
      title: "Neon Speed Racing",
      coverImage: racingCover,
      status: "owned",
      platforms: ["PC", "PlayStation", "Xbox"],
      genre: "Racing",
      releaseDate: "2024-01-10",
      rating: 7.8
    },
    {
      id: "lib3",
      title: "Pixel Adventure Quest",
      coverImage: puzzleCover,
      status: "completed",
      platforms: ["PC", "Switch", "Mobile"],
      genre: "Puzzle Platformer",
      releaseDate: "2023-11-05",
      rating: 8.9
    },
    {
      id: "lib4",
      title: "Cyber Assault: Future Wars",
      coverImage: scifiShooterCover,
      status: "playing",
      platforms: ["PC", "Xbox"],
      genre: "FPS",
      releaseDate: "2024-06-20",
      rating: 8.5
    }
  ];

  // Filter games based on search query
  const filteredGames = ownedGames.filter(game =>
    game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    game.genre.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleStatusChange = (gameId: string, status: string) => {
    console.log(`Status changed for game ${gameId} to ${status}`);
  };

  const handleGameClick = (game: Game) => {
    console.log(`Clicked on game: ${game.title}`);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-library-title">Library</h1>
        <p className="text-muted-foreground">Your owned game collection</p>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search your library..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-library-search"
        />
      </div>

      <GameGrid
        games={filteredGames}
        title={`Your Library (${filteredGames.length} games)`}
        onGameClick={handleGameClick}
        onStatusChange={handleStatusChange}
        showFilters={true}
      />
    </div>
  );
}