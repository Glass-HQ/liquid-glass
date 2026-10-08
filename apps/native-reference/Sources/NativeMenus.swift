import SwiftUI

struct NativeMenu: View {
    let material: Glass
    var body: some View {
        Menu {
            ForEach(["Share", "Save to library", "Download"], id: \.self) { title in
                Button(title) {}
            }
        } label: {
            NativeIcon(kind: .more).frame(width: 52, height: 52)
                .glassEffect(material.interactive(), in: .capsule)
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
        .accessibilityLabel("Options")
    }
}
