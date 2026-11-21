import SwiftUI

struct ReferenceAlbum: Decodable, Identifiable {
    var title: String
    var artist: String
    var art: String
    var id: String { title }
}
struct ReferenceContent: Decodable {
    var nowPlaying: ReferenceAlbum
    var albums: [ReferenceAlbum]
    static let shared: ReferenceContent = {
        guard let url = Bundle.main.url(forResource: "site-content", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let content = try? JSONDecoder().decode(ReferenceContent.self, from: data) else {
            fatalError("Native reference content is missing. Rebuild with vp run native:build.")
        }
        return content
    }()
}
struct ReferenceArtwork: View {
    let url: String
    var body: some View {
        AsyncImage(url: URL(string: url)) { phase in
            if let image = phase.image { image.resizable().scaledToFill() }
            else { Color.gray.opacity(0.15) }
        }.clipped()
    }
}
