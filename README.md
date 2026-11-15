# Voronoi

An interactive geometry playground for exploring **Voronoi diagrams** and **Delaunay triangulations**.

A Voronoi diagram divides an area into regions based on which point is closest. Weighted points use a power diagram, letting stronger points claim more space. Delaunay triangulation connects those points into triangles. Move a point and the surrounding geometry changes instantly.

### Explore

- **Drag** points or cells to reshape the diagram.
- **Add Points** to create new regions, **+ Weighted Point** to add a randomly placed point with extra influence, or **Randomize** to rearrange existing points.
- **Show Delaunay** to switch between the two diagrams.
- **Map** to overlay the geometry on real streets in Amsterdam.
- **Build Cells** to watch Voronoi regions form through polygon clipping.
- **Sweep Line** to explore a Fortune-style sweep-line visualization, including its beachline and circle events. This is an illustration, not a full Fortune's algorithm implementation.
- **Show Robots / Hide Robots** to watch four robots roam between changing destinations, planning around obstacles and dynamically avoiding each other.
- **Ocean Mode** to simulate four underwater vehicles surveying Voronoi zones along a fictional coast. Track coverage and battery, and add priority monitoring stations.

The map illustrates straight-line proximity, not driving distance.

**[Try it live](https://dkaban.github.io/voronoi-game/)**
