# GameRadarr Design Guidelines

## Design Approach
**Selected Approach**: Design System (Material Design) with productivity app influences
**Justification**: This is a utility-focused application for managing game collections, requiring clear information hierarchy, efficient navigation, and data-dense displays. Drawing inspiration from productivity tools like Notion and Trello for organization features.

## Core Design Elements

### Color Palette
**Dark Mode Primary** (main interface):
- Background: 222 15% 12%
- Surface: 222 15% 16% 
- Primary: 210 100% 60%
- Secondary: 270 60% 70%
- Text: 210 15% 95%

**Light Mode Primary**:
- Background: 210 20% 98%
- Surface: 210 20% 95%
- Primary: 210 100% 50%
- Secondary: 270 60% 60%
- Text: 222 15% 15%

**Accent Colors**:
- Success (owned games): 142 70% 45%
- Warning (wishlisted): 35 85% 55%
- Info (upcoming): 210 100% 60%

### Typography
- **Primary Font**: Inter (Google Fonts)
- **Headings**: 600-700 weight, sizes from text-lg to text-3xl
- **Body Text**: 400-500 weight, text-sm to text-base
- **Monospace** (for technical details): JetBrains Mono

### Layout System
**Spacing Primitives**: Tailwind units of 2, 4, 6, and 8
- Tight spacing: p-2, gap-2 (form elements, cards)
- Standard spacing: p-4, gap-4 (components, sections)
- Generous spacing: p-6, gap-6 (page sections)
- Large spacing: p-8, gap-8 (major layout areas)

### Component Library

**Navigation**:
- Fixed sidebar with collapsible sections
- Top header with search bar and user controls
- Breadcrumb navigation for deep sections

**Data Displays**:
- Game cards with cover art, title, platform badges
- Grid and list view toggles
- Sortable tables for detailed game information
- Status indicators (owned, wishlisted, playing, completed)

**Forms**:
- Clean input fields with floating labels
- Multi-select dropdowns for platforms/genres
- Toggle switches for monitoring settings
- Date pickers for release tracking

**Overlays**:
- Modal dialogs for game details
- Slide-out panels for filters
- Toast notifications for status updates
- Confirmation dialogs for actions

**Core Features Layout**:
- **Dashboard**: Overview cards showing collection stats, recent additions, upcoming releases
- **Library**: Filterable grid/list of owned games with search
- **Wishlist**: Games being monitored with release status
- **Calendar**: Timeline view of upcoming releases
- **Discovery**: Search and browse new games with IGDB integration

### Images
**Game Cover Art**: Primary visual element throughout the interface
- Card thumbnails: 300x400px ratio maintained
- Detail view: Larger cover display with screenshot gallery
- Grid layouts: Consistent aspect ratios for clean alignment

**No Large Hero Image**: This is a utility application focused on data management rather than marketing appeal.

### Animations
**Minimal and Functional**:
- Subtle hover states on interactive elements
- Smooth transitions between view modes (grid/list)
- Loading states for API calls
- No decorative animations to maintain focus on productivity

This design prioritizes information density, quick scanning, and efficient task completion while maintaining visual appeal through thoughtful use of color, typography, and spacing.