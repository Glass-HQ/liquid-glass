import SwiftUI
import AppKit

// Public system controls: do not wrap the thumb in an additional glassEffect.
struct NativeValueControls: View {
    let kind: String
    let tint: Color?
    @State private var stepped = false
    @State private var mode = "Standard"
    @State private var value = 50.0
    @State private var appKitValue = 50.0
    @State private var checked = true
    @State private var appKitChecked = true
    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack {
                Text("Native").font(.caption)
                Spacer()
                if kind != "Switch" { Text(value, format: .number.precision(.fractionLength(0))).monospacedDigit() }
            }
            if kind == "Switch" {
                Toggle("Notifications", isOn: $checked).toggleStyle(.switch)
            } else if stepped && mode == "Labelled ticks" {
                Slider(value: $value, in: 0...100, step: 25,
                    label: { Text("Volume") },
                    tick: { position in SliderTick(position) { Text(Int(position), format: .number) } })

            } else if stepped {
                Slider(value: $value, in: 0...100, step: 25,
                    neutralValue: mode == "Neutral" ? 50 : nil) { Text("Volume") }
                    minimumValueLabel: { Image(systemName: "speaker.fill") }
                    maximumValueLabel: { Image(systemName: "speaker.wave.3.fill") }

            } else {
                Slider(value: $value, in: 0...100,
                    neutralValue: mode == "Neutral" ? 50 : nil) { Text("Volume") }
                    minimumValueLabel: { Image(systemName: "speaker.fill") }
                    maximumValueLabel: { Image(systemName: "speaker.wave.3.fill") }

            }
            HStack {
                Text("AppKit").font(.caption)
                Spacer()
                if kind != "Switch" { Text(appKitValue, format: .number.precision(.fractionLength(0))).monospacedDigit() }
            }
            if kind == "Switch" {
                HStack { Text("Notifications"); Spacer(); ReferenceSwitch(value: $appKitChecked) }
            } else {
                ReferenceSlider(value: $appKitValue, stepped: stepped)
                    .frame(height: 28)
            }
            if kind != "Switch" {
                Picker("Slider behavior", selection: $stepped) {
                    Text("Continuous").tag(false)
                    Text("Stepped").tag(true)
                }.pickerStyle(.segmented)
                Picker("Native variant", selection: $mode) {
                    Text("Standard").tag("Standard")
                    Text("Neutral at 50").tag("Neutral")
                    if stepped { Text("Labelled ticks").tag("Labelled ticks") }
                }.pickerStyle(.menu)
            }
            Text("System material · tint applies to native controls")
                .font(.caption2).foregroundStyle(.secondary)
        }.frame(width: 280).tint(tint ?? .accentColor)
    }
}
private struct ReferenceSlider: NSViewRepresentable {
    @Binding var value: Double
    let stepped: Bool
    func makeCoordinator() -> Coordinator { Coordinator(value: $value) }
    func makeNSView(context: Context) -> NSSlider {
        let view = NSSlider(value: value, minValue: 0, maxValue: 100, target: context.coordinator, action: #selector(Coordinator.changed(_:)))
        view.isContinuous = true
        view.numberOfTickMarks = stepped ? 5 : 0
        view.allowsTickMarkValuesOnly = stepped
        view.setAccessibilityLabel("Volume")
        return view
    }
    func updateNSView(_ view: NSSlider, context: Context) {
        context.coordinator.value = $value
        view.numberOfTickMarks = stepped ? 5 : 0
        view.allowsTickMarkValuesOnly = stepped
        view.doubleValue = value
    }
    final class Coordinator: NSObject {
        var value: Binding<Double>
        init(value: Binding<Double>) { self.value = value }
        @objc func changed(_ sender: NSSlider) { value.wrappedValue = sender.doubleValue }
    }
}
private struct ReferenceSwitch: NSViewRepresentable {
    @Binding var value: Bool
    func makeCoordinator() -> Coordinator { Coordinator(value: $value) }
    func makeNSView(context: Context) -> NSSwitch {
        let view = NSSwitch()
        view.target = context.coordinator
        view.action = #selector(Coordinator.changed(_:))
        view.setAccessibilityLabel("Notifications")
        return view
    }
    func updateNSView(_ view: NSSwitch, context: Context) {
        context.coordinator.value = $value
        view.state = value ? .on : .off
    }
    final class Coordinator: NSObject {
        var value: Binding<Bool>
        init(value: Binding<Bool>) { self.value = value }
        @objc func changed(_ sender: NSSwitch) { value.wrappedValue = sender.state == .on }
    }
}
