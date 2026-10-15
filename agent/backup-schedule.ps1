function Get-BackupScheduleDue {
    [CmdletBinding()]
    param(
        [datetime]$Now = (Get-Date),
        [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$Time = '02:00',
        [ValidateSet(1, 3)][int]$IntervalMonths = 1
    )

    $month = $Now.Month - (($Now.Month - 1) % $IntervalMonths)
    $due = (New-Object datetime($Now.Year, $month, 1)).Add([TimeSpan]::Parse($Time))
    if ($due -gt $Now) { $due = $due.AddMonths(-$IntervalMonths) }
    return $due
}

function New-BackupTaskXml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Execute,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$UserId,
        [datetime]$Now = (Get-Date),
        [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$Time = '02:00',
        [ValidateSet(1, 3)][int]$IntervalMonths = 1
    )

    # The Task Scheduler XML schema avoids inconsistent monthly-trigger CIM types across Windows builds.
    [xml]$document = @'
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description /></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary /><Enabled>true</Enabled>
      <ScheduleByMonth><DaysOfMonth><Day>1</Day></DaysOfMonth><Months /></ScheduleByMonth>
    </CalendarTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId /></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="BackupUser"><UserId /><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled>
    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT30M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="BackupUser"><Exec><Command /><Arguments /><WorkingDirectory /></Exec></Actions>
</Task>
'@
    $schema = 'http://schemas.microsoft.com/windows/2004/02/mit/task'
    $ns = New-Object System.Xml.XmlNamespaceManager($document.NameTable)
    $ns.AddNamespace('t', $schema)
    $due = Get-BackupScheduleDue -Now $Now -Time $Time -IntervalMonths $IntervalMonths
    $values = @{
        '//t:Description' = 'Encrypted Firestore and Storage backup on day 1 every ' + $IntervalMonths + ' month(s); never deletes older copies.'
        '//t:StartBoundary' = $due.ToString('yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
        '//t:LogonTrigger/t:UserId' = $UserId
        '//t:Principal/t:UserId' = $UserId
        '//t:Exec/t:Command' = $Execute
        '//t:Exec/t:Arguments' = $Arguments
        '//t:Exec/t:WorkingDirectory' = $WorkingDirectory
    }
    foreach ($entry in $values.GetEnumerator()) { $document.SelectSingleNode($entry.Key, $ns).InnerText = $entry.Value }
    $months = $document.SelectSingleNode('//t:ScheduleByMonth/t:Months', $ns)
    $names = [Globalization.CultureInfo]::InvariantCulture.DateTimeFormat.MonthNames
    for ($month = 1; $month -le 12; $month += $IntervalMonths) {
        [void]$months.AppendChild($document.CreateElement($names[$month - 1], $schema))
    }
    return $document.OuterXml
}
