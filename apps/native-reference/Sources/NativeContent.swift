import SwiftUI

struct ReferenceAlbum: Decodable, Identifiable {
    var title: String
    var artist: String
    var art: String
    var id: String { title }
}
struct ReferenceMessage: Decodable, Identifiable {
    var id: Int
    var from: String
    var text: String?
    var photo: String?
    var link: Bool?
}
struct ReferenceArticleBlock: Decodable {
    var kind: String
    var text: String
}
struct ReferenceArticle: Decodable {
    var title: String
    var dek: String
    var byline: String
    var blocks: [ReferenceArticleBlock]
}
struct ReferenceContent: Decodable {
    var nowPlaying: ReferenceAlbum
    var albums: [ReferenceAlbum]
    var messages: [ReferenceMessage]
    var article: ReferenceArticle
    static let shared: ReferenceContent = {
        guard let url = Bundle.main.url(forResource: "site-content", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let content = try? JSONDecoder().decode(ReferenceContent.self, from: data) else {
            fatalError("Native reference content is missing. Rebuild with bun run native:build.")
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
