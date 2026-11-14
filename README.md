# Voronoi

An interactive geometry playground for exploring **Voronoi diagrams** and **Delaunay triangulations**.

A Voronoi diagram divides an area into regions based on which point is closest. Delaunay triangulation connects those points into triangles. Move a point and the surrounding geometry changes instantly.

### Explore

- **Drag** points or cells to reshape the diagram.
- **Add Points** to create new regions, or **Randomize** to rearrange the existing points.
- **Show Delaunay** to switch between the two diagrams.
- **Map** to overlay the geometry on real streets in Amsterdam.
- **Build Cells** to watch Voronoi regions form through polygon clipping.
- **Sweep Line** to explore a Fortune-style sweep-line visualization, including its beachline and circle events. This is an illustration, not a full Fortune's algorithm implementation.
- **Show Robots / Hide Robots** to toggle three animated robots that navigate around point obstacles using clearance-aware A* routes.

The map illustrates straight-line proximity, not driving distance.

**[Try it live](https://dkaban.github.io/voronoi-game/)**
